// Rendu du plan 2D (écran et impression)
import { store, topo, wallGeoms, resolvedRooms, outsideSide, fmtLen, levelData, ghostLevel, roofLevelIndex, isVoidRoom } from './model.js';
import { add, sub, mul, norm, perp, dist, lerp, dot, centroid, signedArea, area, distToLine, simplifyPoly, rot } from './geom.js';
import { wallPieces, pointOnWall, OPENING_TYPES, openingRange, wallPoly } from './walls.js';
import { FURNITURE } from './furniture.js';
import { roofGeometry } from './roof.js';
import { drawBackground, backgroundCorners } from './background.js';
import { joinery } from './joinery.js';

export const FLOOR_COLORS = { parquet: '#f4e9d8', carrelage: '#e8eef3', beton: '#ececea', moquette: '#efe9f2' };
const DIM_COLOR = '#1f3f73';

export function makeS(V) { return (p) => ({ x: p.x * V.scale + V.ox, y: p.y * V.scale + V.oy }); }

export function pathPoly(ctx, pts, S, close = true) {
  ctx.beginPath();
  pts.forEach((p, i) => { const q = S(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
  if (close) ctx.closePath();
}
export function line(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

export function text(ctx, str, x, y, { size = 11, u = 1, color = '#222', align = 'center', base = 'middle', bold = false, angle = 0, bg = null } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.font = `${bold ? '600 ' : ''}${size * u}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (bg) {
    const m = ctx.measureText(str);
    const w = m.width + 6 * u, h = size * u * 1.3;
    const ox = align === 'center' ? -w / 2 : align === 'right' ? -w + 3 * u : -3 * u;
    const oy = base === 'middle' ? -h / 2 : base === 'bottom' ? -h : 0;
    ctx.fillStyle = bg; ctx.fillRect(ox, oy, w, h);
  }
  ctx.fillStyle = color; ctx.fillText(str, 0, 0);
  ctx.restore();
}

// Ligne de cote (points en coordonnées écran), style architecte : traits obliques aux extrémités
export function dimScreen(ctx, pa, pb, a, b, label, u, color = DIM_COLOR, size = 10) {
  ctx.strokeStyle = color; ctx.lineWidth = 0.7 * u;
  const L = dist(a, b);
  if (L < 2) return;
  const off = sub(a, pa);
  const ol = Math.hypot(off.x, off.y);
  if (ol > 0.5) {
    const od = mul(off, 1 / ol);
    line(ctx, add(pa, mul(od, 3 * u)), add(a, mul(od, 4 * u)));
    line(ctx, add(pb, mul(od, 3 * u)), add(b, mul(od, 4 * u)));
  }
  const t = norm(sub(b, a));
  line(ctx, sub(a, mul(t, 4 * u)), add(b, mul(t, 4 * u)));
  const k = mul(norm(add(t, perp(t))), 3.5 * u);
  ctx.lineWidth = 1.3 * u;
  line(ctx, sub(a, k), add(a, k));
  line(ctx, sub(b, k), add(b, k));
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI;
  if (ang <= -Math.PI / 2 + 1e-6) ang += Math.PI;
  const mid = lerp(a, b, 0.5);
  ctx.font = `${size * u}px -apple-system, Helvetica, Arial, sans-serif`;
  const tw = ctx.measureText(label).width;
  // texte trop long pour le segment : placé de l'autre côté de la ligne pour ne pas chevaucher les voisins
  const tooLong = tw + 6 * u > L;
  text(ctx, label, mid.x, mid.y, { size: tooLong ? size - 1 : size, u, color, base: tooLong ? 'top' : 'bottom', angle: ang });
}

export function dimWorld(ctx, S, u, p1, p2, offVec, label, color, size) {
  const a = S(add(p1, offVec)), b = S(add(p2, offVec));
  dimScreen(ctx, S(p1), S(p2), a, b, label ?? fmtLen(dist(p1, p2)), u, color, size);
}

export function drawNorth(ctx, x, y, size, u, angleDeg = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#222'; ctx.lineWidth = 1 * u;
  ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -size * 0.9); ctx.lineTo(size * 0.35, size * 0.6); ctx.lineTo(0, size * 0.3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -size * 0.9); ctx.lineTo(-size * 0.35, size * 0.6); ctx.lineTo(0, size * 0.3); ctx.closePath(); ctx.stroke();
  ctx.restore();
  text(ctx, 'N', x, y - size - 8 * u, { size: 11, u, bold: true });
}

export function drawScaleBar(ctx, x, y, pxPerCm, u, meters = 5) {
  const segW = 100 * pxPerCm;
  ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8 * u;
  for (let i = 0; i < meters; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#222';
    ctx.fillRect(x + i * segW, y, segW, 4 * u);
    ctx.strokeRect(x + i * segW, y, segW, 4 * u);
  }
  for (let i = 0; i <= meters; i++) text(ctx, String(i), x + i * segW, y + 11 * u, { size: 8, u });
  text(ctx, 'm', x + meters * segW + 10 * u, y + 11 * u, { size: 8, u });
}

function drawGrid(ctx, V) {
  const steps = [10, 50, 100, 500, 1000];
  let step = steps.find((s) => s * V.scale >= 14 * V.u) || 1000;
  const x0 = Math.floor(-V.ox / V.scale / step) * step, x1 = (V.w - V.ox) / V.scale;
  const y0 = Math.floor(-V.oy / V.scale / step) * step, y1 = (V.h - V.oy) / V.scale;
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) {
    const sx = Math.round(x * V.scale + V.ox) + 0.5;
    ctx.strokeStyle = Math.abs(x % (step * 10)) < 1e-6 ? '#d5dbe3' : '#eef1f5';
    line(ctx, { x: sx, y: 0 }, { x: sx, y: V.h });
  }
  for (let y = y0; y <= y1; y += step) {
    const sy = Math.round(y * V.scale + V.oy) + 0.5;
    ctx.strokeStyle = Math.abs(y % (step * 10)) < 1e-6 ? '#d5dbe3' : '#eef1f5';
    line(ctx, { x: 0, y: sy }, { x: V.w, y: sy });
  }
}

// ---------- Ouvertures ----------
function drawOpening(ctx, S, u, o, g, opts) {
  const T = OPENING_TYPES[o.type] || OPENING_TYPES.fenetre;
  const [s0, s1] = openingRange(o, g);
  const P = (s, side) => S(pointOnWall(g, s, side));
  const color = opts.sel ? '#1a73e8' : '#222';
  ctx.strokeStyle = color; ctx.lineWidth = 0.9 * u;
  // tableaux (jambages)
  line(ctx, P(s0, 1), P(s0, -1));
  line(ctx, P(s1, 1), P(s1, -1));
  const side = o.side || 1;
  if (T.kind === 'window') {
    ctx.lineWidth = 0.7 * u;
    line(ctx, P(s0, 1), P(s1, 1));
    line(ctx, P(s0, -1), P(s1, -1));
    ctx.lineWidth = 1 * u;
    line(ctx, P(s0, 0.15), P(s1, 0.15));
    line(ctx, P(s0, -0.15), P(s1, -0.15));
  } else if (T.kind === 'door' || T.kind === 'french') {
    const leaves = T.kind === 'french' && joinery(o).leaves !== 1 ? [[s0, s0 + (s1 - s0) / 2, false], [s1, s0 + (s1 - s0) / 2, true]] : [[o.hinge === 'end' ? s1 : s0, o.hinge === 'end' ? s0 : s1, o.hinge === 'end']];
    if (T.kind === 'french') { ctx.lineWidth = 0.7 * u; line(ctx, P(s0, 0), P(s1, 0)); }
    for (const [sh, se] of leaves) {
      const w = Math.abs(se - sh);
      const hingeW = pointOnWall(g, sh, side);
      const leafEnd = add(hingeW, mul(g.n, side * w));
      const closedEnd = pointOnWall(g, se, side);
      ctx.lineWidth = 1.2 * u;
      line(ctx, S(hingeW), S(leafEnd));
      ctx.lineWidth = 0.6 * u;
      ctx.setLineDash([]);
      const c = S(hingeW);
      const a1 = Math.atan2(S(leafEnd).y - c.y, S(leafEnd).x - c.x);
      const a2 = Math.atan2(S(closedEnd).y - c.y, S(closedEnd).x - c.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(c.x, c.y, dist(S(hingeW), S(leafEnd)), a1, a2, da < 0);
      ctx.stroke();
    }
  } else if (T.kind === 'slider') {
    const mid = (s0 + s1) / 2;
    ctx.lineWidth = 0.7 * u;
    line(ctx, P(s0, 1), P(s1, 1)); line(ctx, P(s0, -1), P(s1, -1));
    ctx.lineWidth = 1.4 * u;
    line(ctx, P(s0, 0.25), P(mid + 10, 0.25));
    line(ctx, P(mid - 10, -0.25), P(s1, -0.25));
  } else if (T.kind === 'garage') {
    ctx.setLineDash([6 * u, 4 * u]);
    ctx.lineWidth = 0.8 * u;
    line(ctx, P(s0, 0), P(s1, 0));
    ctx.setLineDash([]);
  }
  if (opts.labels) {
    const out = outsideSide(o.wallId);
    const sideLbl = out !== 0 ? out : -side;
    const c = add(pointOnWall(g, (s0 + s1) / 2, 0), mul(g.n, sideLbl * (g.t / 2 + 18)));
    const lbl = T.kind === 'window' && o.sill > 0 ? `${Math.round(o.width)}×${Math.round(o.height)} all.${Math.round(o.sill)}` : `${Math.round(o.width)}×${Math.round(o.height)}`;
    let ang = Math.atan2(g.d.y, g.d.x);
    if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI;
    if (ang <= -Math.PI / 2 + 1e-6) ang += Math.PI;
    const q = S(c);
    text(ctx, lbl, q.x, q.y, { size: 8.5, u, color: '#555', angle: ang });
  }
}

// ---------- Cotations automatiques extérieures ----------
function drawAutoDims(ctx, S, u, d, G) {
  const T = topo();
  for (const fp of T.footprints) {
    const C = fp.center, O = fp.outer, n = C.length;
    const sa = signedArea(C);
    for (let i = 0; i < n; i++) {
      const P0 = O[i], P1 = O[(i + 1) % n];
      const Lext = dist(P0, P1);
      if (Lext < 5) continue;
      const dir = norm(sub(P1, P0));
      const outN = sa > 0 ? mul(perp(dir), -1) : perp(dir);
      const c0 = C[i], c1 = C[(i + 1) % n];
      const pts = [0, Lext];
      for (const w of d.walls) {
        const g = G.get(w.id);
        if (!g) continue;
        if (distToLine(w.a, c0, c1) > 1 || distToLine(w.b, c0, c1) > 1) continue;
        for (const o of d.openings) {
          if (o.wallId !== w.id) continue;
          const [s0, s1] = openingRange(o, g);
          for (const s of [s0, s1]) {
            const q = pointOnWall(g, s, 0);
            const t = dot(sub(q, P0), dir);
            if (t > 1 && t < Lext - 1) pts.push(t);
          }
        }
      }
      pts.sort((a, b) => a - b);
      const uniq = pts.filter((v, k) => k === 0 || v - pts[k - 1] > 0.5);
      const at = (t) => add(P0, mul(dir, t));
      if (uniq.length > 2) {
        for (let k = 0; k < uniq.length - 1; k++) dimWorld(ctx, S, u, at(uniq[k]), at(uniq[k + 1]), mul(outN, 70), fmtLen(uniq[k + 1] - uniq[k]));
        dimWorld(ctx, S, u, P0, P1, mul(outN, 130), fmtLen(Lext));
      } else {
        dimWorld(ctx, S, u, P0, P1, mul(outN, 70), fmtLen(Lext));
      }
    }
  }
}

function roomInnerDims(inner) {
  const s = simplifyPoly(inner).poly;
  if (s.length !== 4) return null;
  const e = [0, 1, 2, 3].map((i) => sub(s[(i + 1) % 4], s[i]));
  for (let i = 0; i < 4; i++) if (Math.abs(dot(norm(e[i]), norm(e[(i + 1) % 4]))) > 0.02) return null;
  return [Math.hypot(e[0].x, e[0].y), Math.hypot(e[1].x, e[1].y)];
}

// ---------- Rendu principal ----------
export function drawPlan(ctx, V, opts = {}) {
  const d = store.doc;
  const st = d.settings;
  const S = makeS(V);
  const u = V.u;
  const G = wallGeoms();
  const sel = opts.print ? null : store.selection;
  const isSel = (type, id) => sel && sel.type === type && sel.id === id;

  if (!opts.noBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, V.w, V.h); }
  if (!opts.print) drawGrid(ctx, V);

  // Fond de plan (PDF / image importé)
  if (d.background && d.background.visible !== false && (!opts.print || d.background.print)) drawBackground(ctx, S, V, d.background, isSel('background', 'background'));

  // Parcelle
  if (d.parcel && d.parcel.pts.length >= 2 && opts.parcel !== false) {
    pathPoly(ctx, d.parcel.pts, S, d.parcel.pts.length > 2);
    ctx.fillStyle = 'rgba(120,170,90,0.08)';
    if (d.parcel.pts.length > 2) ctx.fill();
    ctx.strokeStyle = isSel('parcel', 'parcel') ? '#1a73e8' : '#3d7a2f';
    ctx.lineWidth = 1.4 * u; ctx.setLineDash([14 * u, 4 * u, 3 * u, 4 * u]);
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Sols des pièces
  for (const r of resolvedRooms()) {
    if (!r.inner || r.dup) continue;
    pathPoly(ctx, r.inner, S);
    const isVoid = d.activeLevel > 0 && isVoidRoom(r.room.name);
    ctx.fillStyle = isSel('room', r.room.id) ? '#dbe8fb' : isVoid ? '#fff' : FLOOR_COLORS[r.room.floor] || '#f5f5f5';
    ctx.fill();
    if (isVoid) {
      // trémie / vide : croix en trait fin (pas de plancher)
      const xs = r.inner.map((p) => p.x), ys = r.inner.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      ctx.save(); pathPoly(ctx, r.inner, S); ctx.clip();
      ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.6 * u;
      line(ctx, S({ x: x0, y: y0 }), S({ x: x1, y: y1 })); line(ctx, S({ x: x0, y: y1 }), S({ x: x1, y: y0 }));
      ctx.restore();
    }
  }

  // Niveau voisin en filigrane (repère pour aligner les étages)
  const ghost = opts.print ? null : ghostLevel();
  if (ghost) {
    const GG = levelData(ghost).geoms;
    ctx.fillStyle = 'rgba(60,110,200,0.32)';
    for (const w of ghost.walls) { const g = GG.get(w.id); if (g) { pathPoly(ctx, wallPoly(g), S); ctx.fill(); } }
  }

  // Mobilier
  if (st.showFurniture && opts.furniture !== false) {
    for (const f of d.furniture) {
      const def = FURNITURE[f.type];
      if (!def) continue;
      const c = S(f);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate((f.rot * Math.PI) / 180);
      ctx.scale(V.scale, V.scale);
      ctx.beginPath();
      def.draw(ctx, f.w, f.d);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.lineWidth = (isSel('furniture', f.id) ? 1.6 : 0.6) * u / V.scale;
      ctx.strokeStyle = isSel('furniture', f.id) ? '#1a73e8' : '#6b6b6b';
      ctx.stroke();
      ctx.restore();
    }
  }

  // Murs (intérieurs puis extérieurs, pochés)
  const order = [...d.walls].sort((a, b) => (a.type === 'ext') - (b.type === 'ext'));
  for (const w of order) {
    const g = G.get(w.id);
    if (!g) continue;
    const pieces = wallPieces(w, g, d.openings).filter((p) => p.z0 < 1);
    const base = w.type === 'ext' ? '#3b3b3b' : '#8c8c8c';
    ctx.strokeStyle = base; ctx.lineWidth = 0.5 * u;
    for (const p of pieces) { ctx.fillStyle = p.below ? '#ebebeb' : base; pathPoly(ctx, p.poly, S); ctx.fill(); ctx.stroke(); }
  }
  // Ouvertures
  for (const o of d.openings) {
    const g = G.get(o.wallId);
    if (g) drawOpening(ctx, S, u, o, g, { sel: isSel('opening', o.id), labels: opts.print || V.scale > 0.35 });
  }

  // Toitures (en pointillés, au-dessus)
  if (st.showRoof && opts.roof !== false) {
    for (const r of d.roofs) {
      if (roofLevelIndex(r) !== d.activeLevel) continue;
      const geo = roofGeometry(r);
      ctx.strokeStyle = isSel('roof', r.id) ? '#1a73e8' : '#9a5b2b';
      ctx.lineWidth = (isSel('roof', r.id) ? 1.8 : 0.9) * u;
      ctx.setLineDash([8 * u, 5 * u]);
      pathPoly(ctx, geo.lines.outline, S); ctx.stroke();
      ctx.lineWidth = 0.7 * u;
      for (const [a, b] of [...geo.lines.ridge, ...geo.lines.hips]) line(ctx, S(a), S(b));
      ctx.setLineDash([]);
    }
  }

  // Cotes
  if (st.autoDims && opts.dims !== false) drawAutoDims(ctx, S, u, d, G);
  for (const dm of d.dims) {
    const dir = norm(sub(dm.b, dm.a));
    const off = mul(perp(dir), dm.offset);
    dimWorld(ctx, S, u, dm.a, dm.b, off, fmtLen(dist(dm.a, dm.b)), isSel('dim', dm.id) ? '#1a73e8' : DIM_COLOR);
  }

  // Étiquettes des pièces
  for (const r of resolvedRooms()) {
    if (!r.inner || r.dup) continue;
    const c = S(r.room.seed);
    const big = opts.print ? 10 : Math.max(9, Math.min(13, 8 + V.scale * 6));
    text(ctx, r.room.name, c.x, c.y - big * 0.7 * u, { size: big, u, bold: true, color: isSel('room', r.room.id) ? '#1a73e8' : '#1d1d1d' });
    text(ctx, `${(r.area / 1e4).toFixed(2).replace('.', ',')} m²`, c.x, c.y + big * 0.55 * u, { size: big - 1, u, color: '#444' });
    const dims = roomInnerDims(r.inner);
    if (dims && (opts.print || V.scale > 0.3)) text(ctx, `${fmtLen(dims[0])} × ${fmtLen(dims[1])}`, c.x, c.y + big * 1.65 * u, { size: big - 2.5, u, color: '#777' });
  }

  // Ligne de coupe
  if (d.section && opts.section !== false) drawSectionMark(ctx, S, u, d.section, isSel('section', 'section'));

  if (opts.overlay) opts.overlay(ctx, V, S);
}

export function sectionFrame(sec) {
  let u = norm(sub(sec.b, sec.a));
  let v = { x: u.y, y: -u.x };
  if (sec.flip) { u = mul(u, -1); v = mul(v, -1); }
  return { O: sec.a, u, v };
}

function drawSectionMark(ctx, S, u, sec, selected) {
  const A = S(sec.a), B = S(sec.b);
  const col = selected ? '#1a73e8' : '#c0392b';
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 1.4 * u;
  ctx.setLineDash([16 * u, 4 * u, 3 * u, 4 * u]);
  line(ctx, A, B);
  ctx.setLineDash([]);
  const { v } = sectionFrame(sec);
  for (const P of [A, B]) {
    ctx.lineWidth = 2.5 * u;
    const tip = add(P, mul(v, 22 * u));
    line(ctx, P, tip);
    const pv = perp(v);
    ctx.beginPath();
    ctx.moveTo(tip.x + v.x * 8 * u, tip.y + v.y * 8 * u);
    ctx.lineTo(tip.x + pv.x * 6 * u, tip.y + pv.y * 6 * u);
    ctx.lineTo(tip.x - pv.x * 6 * u, tip.y - pv.y * 6 * u);
    ctx.closePath(); ctx.fill();
    const lp = add(P, mul(v, -14 * u));
    text(ctx, sec.label || 'A', lp.x, lp.y, { size: 13, u, bold: true, color: col });
  }
}

// Emprise totale (pour cadrer la vue / l'impression)
export function planExtents(includeParcel = false) {
  const d = store.doc;
  const pts = [];
  const G = wallGeoms();
  for (const w of d.walls) { const g = G.get(w.id); if (g) pts.push(...wallPoly(g)); }
  for (const f of d.furniture) pts.push({ x: f.x - f.w / 2, y: f.y - f.d / 2 }, { x: f.x + f.w / 2, y: f.y + f.d / 2 });
  for (const r of d.roofs) if (roofLevelIndex(r) === d.activeLevel) pts.push(...roofGeometry(r).lines.outline);
  for (const dm of d.dims) pts.push(dm.a, dm.b);
  if (includeParcel && d.parcel) pts.push(...d.parcel.pts);
  if (includeParcel && d.background && d.background.visible !== false) pts.push(...backgroundCorners(d.background));
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const m = d.settings.autoDims ? 170 : 60;
  return { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
}
