// Toitures : 4 pans, 2 pans, toit plat (sur emprise rectangulaire orientée)
import { rot, add } from './geom.js';

export const ROOF_TYPES = { '4pans': 'Toiture 4 pans', '2pans': 'Toiture 2 pans', plat: 'Toit plat' };

function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    nx += (p.y - q.y) * (p.z + q.z);
    ny += (p.z - q.z) * (p.x + q.x);
    nz += (p.x - q.x) * (p.y + q.y);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.some((q) => Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01 && Math.abs(q.z - p.z) < 0.01)) out.push(p);
  return out;
}

// Retourne les faces 3D (repère plan x,y + z vers le haut) et les lignes 2D pour le plan
export function roofGeometry(r) {
  const ang = (r.angle * Math.PI) / 180;
  const tan = Math.tan((r.pitch * Math.PI) / 180);
  const o = r.type === 'plat' ? Math.min(r.overhang, 30) : r.overhang;
  const a = r.length / 2 + o, b = r.width / 2 + o;
  const eave = r.eave; // hauteur du haut des murs
  const he = r.type === 'plat' ? eave : eave - o * tan;
  const W = (x, y, z) => { const p = add(rot({ x, y }, ang), { x: r.cx, y: r.cy }); return { x: p.x, y: p.y, z }; };
  const P2 = (x, y) => add(rot({ x, y }, ang), { x: r.cx, y: r.cy });
  const faces = [];
  const c = [[-a, -b], [a, -b], [a, b], [-a, b]];
  let ridgeZ = he, lines = { outline: c.map(([x, y]) => P2(x, y)), ridge: [], hips: [] };

  if (r.type === 'plat') {
    const top = eave + 30;
    const C = (z) => c.map(([x, y]) => W(x, y, z));
    faces.push({ pts: C(top), kind: 'flat' });
    const lo = C(eave), hi = C(top);
    for (let i = 0; i < 4; i++) faces.push({ pts: [lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]], kind: 'fascia' });
    ridgeZ = top;
  } else if (r.type === '2pans') {
    const alongX = a >= b;
    if (alongX) {
      const hr = he + b * tan; ridgeZ = hr;
      const R1 = W(-a, 0, hr), R2 = W(a, 0, hr);
      const C = c.map(([x, y]) => W(x, y, he));
      faces.push({ pts: [C[0], C[1], R2, R1], kind: 'roof' });
      faces.push({ pts: [C[2], C[3], R1, R2], kind: 'roof' });
      const hl = r.length / 2, hw = r.width / 2;
      for (const sx of [-1, 1]) faces.push({ pts: [W(sx * hl, -hw, eave), W(sx * hl, hw, eave), W(sx * hl, 0, eave + hw * tan)], kind: 'gable' });
      lines.ridge.push([P2(-a, 0), P2(a, 0)]);
    } else {
      const hr = he + a * tan; ridgeZ = hr;
      const R1 = W(0, -b, hr), R2 = W(0, b, hr);
      const C = c.map(([x, y]) => W(x, y, he));
      faces.push({ pts: [C[1], C[2], R2, R1], kind: 'roof' });
      faces.push({ pts: [C[3], C[0], R1, R2], kind: 'roof' });
      const hl = r.length / 2, hw = r.width / 2;
      for (const sy of [-1, 1]) faces.push({ pts: [W(-hl, sy * hw, eave), W(hl, sy * hw, eave), W(0, sy * hw, eave + hl * tan)], kind: 'gable' });
      lines.ridge.push([P2(0, -b), P2(0, b)]);
    }
  } else {
    const C = c.map(([x, y]) => W(x, y, he));
    if (a >= b) {
      const hr = he + b * tan; ridgeZ = hr;
      const R1 = W(-(a - b), 0, hr), R2 = W(a - b, 0, hr);
      faces.push({ pts: [C[0], C[1], R2, R1], kind: 'roof' });
      faces.push({ pts: [C[1], C[2], R2], kind: 'roof' });
      faces.push({ pts: [C[2], C[3], R1, R2], kind: 'roof' });
      faces.push({ pts: [C[3], C[0], R1], kind: 'roof' });
      const r1 = P2(-(a - b), 0), r2 = P2(a - b, 0);
      if (a - b > 0.5) lines.ridge.push([r1, r2]);
      lines.hips.push([P2(-a, -b), r1], [P2(-a, b), r1], [P2(a, -b), r2], [P2(a, b), r2]);
    } else {
      const hr = he + a * tan; ridgeZ = hr;
      const R1 = W(0, -(b - a), hr), R2 = W(0, b - a, hr);
      faces.push({ pts: [C[0], C[1], R1], kind: 'roof' });
      faces.push({ pts: [C[1], C[2], R2, R1], kind: 'roof' });
      faces.push({ pts: [C[2], C[3], R2], kind: 'roof' });
      faces.push({ pts: [C[3], C[0], R1, R2], kind: 'roof' });
      const r1 = P2(0, -(b - a)), r2 = P2(0, b - a);
      if (b - a > 0.5) lines.ridge.push([r1, r2]);
      lines.hips.push([P2(-a, -b), r1], [P2(a, -b), r1], [P2(-a, b), r2], [P2(a, b), r2]);
    }
  }
  // Normales orientées vers l'extérieur
  const center = { x: r.cx, y: r.cy, z: (he + ridgeZ) / 2 };
  for (const f of faces) {
    f.pts = dedupe(f.pts);
    let n = newell(f.pts);
    const m = f.pts.reduce((s, p) => ({ x: s.x + p.x / f.pts.length, y: s.y + p.y / f.pts.length, z: s.z + p.z / f.pts.length }), { x: 0, y: 0, z: 0 });
    const toOut = { x: m.x - center.x, y: m.y - center.y, z: m.z - center.z };
    const wrong = f.kind === 'roof' || f.kind === 'flat' ? n.z < 0 : n.x * toOut.x + n.y * toOut.y + n.z * toOut.z < 0;
    if (wrong) { f.pts.reverse(); n = { x: -n.x, y: -n.y, z: -n.z }; }
    f.n = n;
  }
  return { faces, ridgeZ, eaveZ: he, lines };
}

export function roofFromFootprint(box, settings, id) {
  return {
    id, cx: box.cx, cy: box.cy, length: Math.round(box.w), width: Math.round(box.h), angle: Math.round(box.angle * 10) / 10,
    pitch: 35, overhang: 50, type: '4pans', eave: settings.wallHeight, material: 'tuile',
  };
}
