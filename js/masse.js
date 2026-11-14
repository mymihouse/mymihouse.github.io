// Plan de masse (PCMI2) : parcelle, emprise, toiture, distances aux limites
import { store, fmtLen, allFootprints, stats } from './model.js';
import { add, sub, mul, norm, perp, dist, signedArea, projectOnSegment, area, centroid, bbox } from './geom.js';
import { roofGeometry } from './roof.js';
import { makeS, pathPoly, line, text, dimWorld } from './render2d.js';

export function masseExtents() {
  const d = store.doc;
  const pts = [];
  if (d.parcel && d.parcel.pts.length > 2) pts.push(...d.parcel.pts);
  for (const fp of allFootprints()) pts.push(...fp.outer);
  for (const r of d.roofs) pts.push(...roofGeometry(r).lines.outline);
  if (!pts.length) return null;
  const b = bbox(pts);
  const m = 350;
  return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

export function drawMasse(ctx, V) {
  const d = store.doc;
  const S = makeS(V);
  const u = V.u;
  const T = { footprints: allFootprints() };
  const main = [...T.footprints].sort((a, b) => area(b.outer) - area(a.outer))[0];
  const parcel = d.parcel && d.parcel.pts.length > 2 ? d.parcel.pts : null;
  if (parcel) {
    pathPoly(ctx, parcel, S);
    ctx.fillStyle = '#eef5e8'; ctx.fill();
    ctx.strokeStyle = '#2f6b24'; ctx.lineWidth = 1.8 * u;
    ctx.setLineDash([16 * u, 4 * u, 3 * u, 4 * u]); ctx.stroke(); ctx.setLineDash([]);
    const sa = signedArea(parcel);
    for (let i = 0; i < parcel.length; i++) {
      const a = parcel[i], b = parcel[(i + 1) % parcel.length];
      const dir = norm(sub(b, a));
      const out = sa > 0 ? mul(perp(dir), -1) : perp(dir);
      dimWorld(ctx, S, u, a, b, mul(out, 120), fmtLen(dist(a, b)), '#2f6b24', 9);
    }
  }
  // Emprise du bâtiment (hachurée)
  for (const fp of T.footprints) {
    pathPoly(ctx, fp.outer, S);
    ctx.fillStyle = '#d9d9d9'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 0.6 * u;
    const b = bbox(fp.outer.map(S));
    for (let x = b.minX - b.h; x < b.maxX; x += 7 * u) line(ctx, { x, y: b.maxY }, { x: x + b.h, y: b.minY });
    ctx.restore();
    pathPoly(ctx, fp.outer, S);
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1.6 * u; ctx.stroke();
    if (fp !== main) continue;
    const c = S(centroid(fp.outer));
    text(ctx, 'Construction projetée', c.x, c.y - 7 * u, { size: 10, u, bold: true, bg: 'rgba(255,255,255,0.85)' });
    text(ctx, `Emprise ${stats().emprise.toFixed(2).replace('.', ',')} m²`, c.x, c.y + 8 * u, { size: 9, u, bg: 'rgba(255,255,255,0.85)' });
  }
  // Toitures (traits pleins)
  for (const r of d.roofs) {
    const g = roofGeometry(r);
    ctx.strokeStyle = '#7a3e22'; ctx.lineWidth = 1 * u;
    pathPoly(ctx, g.lines.outline, S); ctx.stroke();
    ctx.lineWidth = 0.7 * u;
    for (const [a, b] of [...g.lines.ridge, ...g.lines.hips]) line(ctx, S(a), S(b));
  }
  // Distances aux limites séparatives
  if (parcel && T.footprints.length) {
    const fpPts = T.footprints.flatMap((f) => f.outer);
    for (let i = 0; i < parcel.length; i++) {
      const a = parcel[i], b = parcel[(i + 1) % parcel.length];
      let best = null;
      for (const p of fpPts) {
        const pr = projectOnSegment(p, a, b);
        if (pr.tRaw < 0 || pr.tRaw > 1) continue;
        if (!best || pr.d < best.d) best = { p, q: pr.point, d: pr.d };
      }
      if (!best || best.d < 5) continue;
      ctx.strokeStyle = '#b03a2e'; ctx.lineWidth = 0.7 * u;
      ctx.setLineDash([4 * u, 3 * u]); line(ctx, S(best.p), S(best.q)); ctx.setLineDash([]);
      const m = S({ x: (best.p.x + best.q.x) / 2, y: (best.p.y + best.q.y) / 2 });
      text(ctx, fmtLen(best.d) + ' m', m.x, m.y, { size: 9, u, color: '#b03a2e', bg: 'rgba(255,255,255,0.9)' });
    }
  }
  if (parcel) {
    const c = S(parcel[0]);
    text(ctx, `Parcelle ${d.project.parcelRef || ''} — ${(area(parcel) / 1e4).toFixed(0)} m²`, c.x + 8 * u, c.y + 16 * u, { size: 9, u, align: 'left', color: '#2f6b24', bold: true });
  }
}
