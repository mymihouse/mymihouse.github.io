// Façades et coupes : projection orthogonale du modèle 3D
import { store, fmtLen, levelInfo, levelData, isVoidRoom } from './model.js';
import { add, sub, mul, dot, signedArea, perp, norm, lineIntersect, linePolyParams, fmtNum } from './geom.js';
import { OPENING_TYPES, wallPoly, openingRange } from './walls.js';
import { roofGeometry } from './roof.js';
import { joinery, joineryLayout, wallFinish, drawFinishPattern, shade } from './joinery.js';
import { text, line, dimScreen, sectionFrame } from './render2d.js';

const COL = { wallExt: '#f3ece0', wallInt: '#f7f7f5', glass: '#cfe0ea', door: '#d8c3a2', garage: '#e4e4e4', roof: '#b9694c', slab: '#d6d3cc', stroke: '#2b2b2b', gable: '#f3ece0' };

export const FACADES = [
  { key: 'sud', label: 'Façade Sud', v: { x: 0, y: -1 } },
  { key: 'est', label: 'Façade Est', v: { x: -1, y: 0 } },
  { key: 'nord', label: 'Façade Nord', v: { x: 0, y: 1 } },
  { key: 'ouest', label: 'Façade Ouest', v: { x: 1, y: 0 } },
];

export function buildFaces() {
  const d = store.doc;
  const fa = d.settings.floorAboveGround, slab = d.settings.slabThickness || 20;
  const faces = [];
  for (const L of levelInfo()) {
    const lv = L.level, z0 = L.z0;
    const { geoms: G, topo: T, outside } = levelData(lv);
    for (const w of lv.walls) {
      const g = G.get(w.id);
      if (!g) continue;
      const poly = wallPoly(g);
      const sa = signedArea(poly);
      const H = z0 + w.height;
      const out = w.type === 'ext' ? outside.get(w.id) || 0 : 0;
      const F = out ? wallFinish(w) : null;
      const fill = w.type === 'ext' ? COL.wallExt : COL.wallInt;
      for (let i = 0; i < 4; i++) {
        const p = poly[i], q = poly[(i + 1) % 4];
        const dir = norm(sub(q, p));
        const n2 = sa > 0 ? mul(perp(dir), -1) : perp(dir);
        const isOut = F && n2.x * g.n.x * out + n2.y * g.n.y * out > 0.9;
        faces.push({ pts: [{ ...p, z: z0 }, { ...q, z: z0 }, { ...q, z: H }, { ...p, z: H }], n: { x: n2.x, y: n2.y, z: 0 }, fill: isOut ? F.color : fill, finish: isOut ? F.type : null, kind: 'wall', wallId: w.id });
      }
      faces.push({ pts: poly.map((p) => ({ ...p, z: H })), n: { x: 0, y: 0, z: 1 }, fill, kind: 'walltop' });
    }
    for (const o of lv.openings) {
      const g = G.get(o.wallId);
      if (!g) continue;
      const def = OPENING_TYPES[o.type] || OPENING_TYPES.fenetre;
      const [s0, s1] = openingRange(o, g);
      const wH = lv.walls.find((w) => w.id === o.wallId)?.height ?? lv.height;
      for (const side of [1, -1]) {
        const base = add(g.a, mul(g.n, side * (g.t / 2 + 0.6)));
        const q0 = add(base, mul(g.d, s0)), q1 = add(base, mul(g.d, s1));
        const zA = z0 + o.sill, zB = z0 + Math.min(o.sill + o.height, wH);
        faces.push({
          pts: [{ ...q0, z: zA }, { ...q1, z: zA }, { ...q1, z: zB }, { ...q0, z: zB }],
          n: { x: g.n.x * side, y: g.n.y * side, z: 0 }, kind: 'opening', okind: def.kind, opening: o,
          fill: def.kind === 'window' || def.kind === 'french' || def.kind === 'slider' ? COL.glass : def.kind === 'garage' ? COL.garage : COL.door,
        });
      }
    }
    // Dalle du rez-de-chaussée ou plancher d'étage (rive visible en façade)
    const zA = L.index === 0 ? -fa : z0 - slab;
    for (const fp of T.footprints) {
      const poly = fp.outer;
      const sa = signedArea(poly);
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const dir = norm(sub(q, p));
        const n2 = sa > 0 ? mul(perp(dir), -1) : perp(dir);
        faces.push({ pts: [{ ...p, z: zA }, { ...q, z: zA }, { ...q, z: z0 }, { ...p, z: z0 }], n: { x: n2.x, y: n2.y, z: 0 }, fill: L.index === 0 ? COL.slab : COL.wallExt, kind: 'slab' });
      }
    }
  }
  for (const r of d.roofs) {
    const geo = roofGeometry(r);
    for (const f of geo.faces) faces.push({ pts: f.pts, n: f.n, fill: f.kind === 'gable' ? COL.gable : COL.roof, kind: f.kind === 'gable' ? 'gable' : 'roof', roofKind: f.kind });
  }
  return faces;
}

function clipPlane(pts, frame) {
  const D = (p) => (p.x - frame.O.x) * frame.v.x + (p.y - frame.O.y) * frame.v.y;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = D(a), db = D(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function project(faces, frame, clip) {
  const res = [];
  for (const f of faces) {
    const facing = f.n.x * frame.v.x + f.n.y * frame.v.y;
    if (facing > 1e-6) continue;
    let pts = clip ? clipPlane(f.pts, frame) : f.pts;
    if (pts.length < 2) continue;
    const P = pts.map((p) => ({ X: (p.x - frame.O.x) * frame.u.x + (p.y - frame.O.y) * frame.u.y, Z: p.z, D: (p.x - frame.O.x) * frame.v.x + (p.y - frame.O.y) * frame.v.y }));
    const minD = Math.min(...P.map((p) => p.D));
    res.push({ f, P, minD });
  }
  res.sort((a, b) => b.minD - a.minD || prio(a.f) - prio(b.f));
  return res;
}
const prio = (f) => ({ slab: 0, wall: 1, walltop: 1, gable: 2, opening: 3, roof: 4 }[f.kind] ?? 1);

export function projectedExtents(frame, clip = false) {
  const pr = project(buildFaces(), frame, clip);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { P } of pr) for (const p of P) { minX = Math.min(minX, p.X); maxX = Math.max(maxX, p.X); minZ = Math.min(minZ, p.Z); maxZ = Math.max(maxZ, p.Z); }
  if (!isFinite(minX)) return null;
  minZ = Math.min(minZ, -store.doc.settings.floorAboveGround);
  return { minX, maxX, minZ, maxZ };
}

export function facadeFrame(fc) {
  const v = fc.v;
  const u = { x: -v.y, y: v.x };
  return { O: { x: 0, y: 0 }, u, v };
}

function drawFaces(ctx, V, pr) {
  const u = V.u;
  const SX = (X) => V.ox + X * V.scale, SZ = (Z) => V.oy - Z * V.scale;
  for (const { f, P } of pr) {
    ctx.beginPath();
    P.forEach((p, i) => (i ? ctx.lineTo(SX(p.X), SZ(p.Z)) : ctx.moveTo(SX(p.X), SZ(p.Z))));
    ctx.closePath();
    ctx.fillStyle = f.fill;
    ctx.fill();
    if (f.finish && f.finish !== 'enduit' && P.length >= 3) {
      ctx.save(); ctx.clip();
      const xs = P.map((p) => p.X), zs = P.map((p) => p.Z);
      drawFinishPattern(ctx, f.finish, f.fill, { X0: Math.min(...xs), X1: Math.max(...xs), Z0: Math.min(...zs), Z1: Math.max(...zs) }, SX, SZ, u);
      ctx.restore();
      ctx.beginPath();
      P.forEach((p, i) => (i ? ctx.lineTo(SX(p.X), SZ(p.Z)) : ctx.moveTo(SX(p.X), SZ(p.Z))));
      ctx.closePath();
    }
    if (f.kind === 'roof' && P.length >= 3) {
      // hachures de tuiles
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(80,30,15,0.35)'; ctx.lineWidth = 0.5 * u;
      const zs = P.map((p) => p.Z), xs = P.map((p) => p.X);
      const z0 = Math.min(...zs), z1 = Math.max(...zs), x0 = Math.min(...xs), x1 = Math.max(...xs);
      for (let z = Math.ceil(z0 / 25) * 25; z < z1; z += 25) line(ctx, { x: SX(x0), y: SZ(z) }, { x: SX(x1), y: SZ(z) });
      ctx.restore();
    }
    ctx.strokeStyle = COL.stroke;
    ctx.lineWidth = (f.kind === 'opening' ? 0.6 : f.kind === 'slab' ? 0.6 : 0.9) * u;
    ctx.stroke();
    if (f.kind === 'opening' && P.length === 4 && f.opening) drawJoinery2D(ctx, f, P, SX, SZ, u);
  }
}

// Menuiserie en façade : cadre à la couleur choisie, vitrages, petits bois, sens d'ouverture
function drawJoinery2D(ctx, f, P, SX, SZ, u) {
  const o = f.opening;
  const xs = P.map((p) => p.X), zs = P.map((p) => p.Z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const w = x1 - x0, h = z1 - z0;
  // vu de l'extérieur : X croissant = gauche→droite ; on retourne si la projection inverse le sens
  const flip = xs[1] < xs[0];
  const X = (x) => (flip ? x1 - x : x0 + x);
  const rect = (a, b, c, d) => { const xa = SX(Math.min(X(a), X(b))), xb = SX(Math.max(X(a), X(b))); ctx.beginPath(); ctx.rect(xa, SZ(z0 + d), xb - xa, (d - c) * (SZ(0) - SZ(1))); }; // z relatifs au bas de la baie
  const J = joinery(o);
  ctx.lineWidth = 0.5 * u; ctx.strokeStyle = COL.stroke;
  if (J.kind === 'door' || J.kind === 'garage') {
    rect(0, w, 0, h); ctx.fillStyle = J.color; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = shade(J.color, J.color < '#888888' ? 0.35 : -0.35);
    if (J.kind === 'garage') for (let z = 25; z < h; z += 25) { ctx.beginPath(); ctx.moveTo(SX(x0), SZ(z0 + z)); ctx.lineTo(SX(x1), SZ(z0 + z)); ctx.stroke(); }
    else { rect(8, w - 8, 10, h - 8); ctx.stroke(); ctx.beginPath(); ctx.arc(SX(X(o.hinge === 'end' ? 12 : w - 12)), SZ(z0 + 105), 1.8 * u, 0, Math.PI * 2); ctx.fillStyle = '#555'; ctx.fill(); }
    return;
  }
  const L = joineryLayout(o, w, h);
  rect(0, w, 0, h); ctx.fillStyle = J.color; ctx.fill(); ctx.stroke();
  for (const g of L.glass) { rect(g.x0, g.x1, g.z0, g.z1); ctx.fillStyle = COL.glass; ctx.fill(); ctx.strokeStyle = COL.stroke; ctx.lineWidth = 0.4 * u; ctx.stroke(); }
  ctx.strokeStyle = J.color < '#888888' ? J.color : shade(J.color, -0.25); ctx.lineWidth = Math.max(0.6 * u, 2.5 * Math.abs(SX(1) - SX(0)));
  for (const b of L.bars) { ctx.beginPath(); ctx.moveTo(SX(X(b.x0)), SZ(z0 + b.z0)); ctx.lineTo(SX(X(b.x1)), SZ(z0 + b.z1)); ctx.stroke(); }
  // sens d'ouverture (convention : pointillés en V, pointe côté charnières)
  ctx.strokeStyle = '#555'; ctx.lineWidth = 0.35 * u; ctx.setLineDash([3 * u, 2 * u]);
  for (const lf of L.leaves) {
    if (lf.fixed) continue;
    if (lf.slider) {
      const m = z0 + (lf.z0 + lf.z1) / 2, a = lf.x0 + (lf.x1 - lf.x0) * 0.25, b = lf.x0 + (lf.x1 - lf.x0) * 0.75, dir = lf.x0 < w / 2 ? 1 : -1;
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(SX(X(a)), SZ(m)); ctx.lineTo(SX(X(b)), SZ(m)); ctx.stroke();
      const tip = dir > 0 ? b : a; ctx.beginPath(); ctx.moveTo(SX(X(tip)), SZ(m)); ctx.lineTo(SX(X(tip - dir * 6)), SZ(m + 4)); ctx.moveTo(SX(X(tip)), SZ(m)); ctx.lineTo(SX(X(tip - dir * 6)), SZ(m - 4)); ctx.stroke(); ctx.setLineDash([3 * u, 2 * u]);
      continue;
    }
    const hx = lf.hinge === 'left' ? lf.x0 : lf.x1, fx = lf.hinge === 'left' ? lf.x1 : lf.x0;
    ctx.beginPath(); ctx.moveTo(SX(X(fx)), SZ(z0 + lf.z1)); ctx.lineTo(SX(X(hx)), SZ(z0 + (lf.z0 + lf.z1) / 2)); ctx.lineTo(SX(X(fx)), SZ(z0 + lf.z0)); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawGround(ctx, V, x0, x1) {
  const u = V.u;
  const fa = store.doc.settings.floorAboveGround;
  const y = V.oy + fa * V.scale;
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2 * u;
  line(ctx, { x: V.ox + x0 * V.scale, y }, { x: V.ox + x1 * V.scale, y });
  ctx.lineWidth = 0.6 * u;
  for (let x = V.ox + x0 * V.scale; x < V.ox + x1 * V.scale; x += 10 * u) line(ctx, { x, y: y + 1 }, { x: x - 6 * u, y: y + 7 * u });
}

function levelMark(ctx, x, y, label, u, below = false) {
  ctx.strokeStyle = '#1f3f73'; ctx.fillStyle = '#1f3f73'; ctx.lineWidth = 0.7 * u;
  line(ctx, { x, y }, { x: x - 46 * u, y });
  const k = below ? 1 : -1;
  ctx.beginPath(); ctx.moveTo(x - 6 * u, y); ctx.lineTo(x - 1 * u, y + k * 6 * u); ctx.lineTo(x - 11 * u, y + k * 6 * u); ctx.closePath(); ctx.fill();
  text(ctx, label, x - 14 * u, y + k * 4 * u, { size: 8.5, u, color: '#1f3f73', align: 'right', base: below ? 'top' : 'bottom' });
}

function heights() {
  const d = store.doc;
  const info = levelInfo();
  let H = 0;
  for (const L of info) { H = Math.max(H, L.top); for (const w of L.level.walls) H = Math.max(H, L.z0 + w.height); }
  let ridge = H, eave = H, best = -Infinity;
  for (const r of d.roofs) { const g = roofGeometry(r); ridge = Math.max(ridge, g.ridgeZ); if (g.ridgeZ > best) { best = g.ridgeZ; eave = g.eaveZ; } }
  return { H, ridge, eave, fa: d.settings.floorAboveGround, floors: info.slice(1).map((L) => ({ z: L.z0, label: `R+${L.index}` })) };
}

function drawLevels(ctx, V, xLeft, xRight) {
  const u = V.u;
  const { H, ridge, eave, fa, floors } = heights();
  const sx = V.ox + xLeft * V.scale - 18 * u;
  const SZ = (z) => V.oy - z * V.scale;
  const f = (z) => (z >= 0 ? '+' : '') + fmtNum(z / 100);
  levelMark(ctx, sx, SZ(-fa), `TN ${f(-fa)}`, u, true);
  levelMark(ctx, sx, SZ(0), '±0,00 sol fini', u);
  for (const fl of floors) levelMark(ctx, sx, SZ(fl.z), `${fl.label} ${f(fl.z)}`, u);
  if (store.doc.roofs.length) {
    levelMark(ctx, sx, SZ(eave), `Égout ${f(eave)}`, u);
    levelMark(ctx, sx, SZ(ridge), `Faîtage ${f(ridge)}`, u);
  } else levelMark(ctx, sx, SZ(H), `Acrotère ${f(H)}`, u);
  // chaîne de cotes verticale à droite
  const xr = V.ox + xRight * V.scale + 30 * u;
  const pts = [-fa, 0, ...floors.map((fl) => fl.z), ...(store.doc.roofs.length ? [eave, ridge] : [H])].sort((a, b) => a - b).filter((z, i, arr) => !i || z - arr[i - 1] > 1);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = { x: xr, y: SZ(pts[i]) }, b = { x: xr, y: SZ(pts[i + 1]) };
    dimScreen(ctx, { x: xr - 20 * u, y: a.y }, { x: xr - 20 * u, y: b.y }, a, b, fmtLen(pts[i + 1] - pts[i]), u);
  }
  const top = pts[pts.length - 1];
  const a = { x: xr + 26 * u, y: SZ(-fa) }, b = { x: xr + 26 * u, y: SZ(top) };
  dimScreen(ctx, { x: xr + 6 * u, y: a.y }, { x: xr + 6 * u, y: b.y }, a, b, fmtLen(top + fa) + ' /TN', u);
}

// Façade seule, centrée dans un rectangle (x,y,w,h en px), à l'échelle donnée (px/cm)
export function drawFacade(ctx, fc, rect, scale, u, title = true) {
  const frame = facadeFrame(fc);
  const ext = projectedExtents(frame);
  if (!ext) return;
  const V = { scale, u, ox: rect.x + rect.w / 2 - ((ext.minX + ext.maxX) / 2) * scale, oy: rect.y + rect.h / 2 + ((ext.minZ + ext.maxZ) / 2) * scale };
  const pr = project(buildFaces(), frame, false);
  drawGround(ctx, V, ext.minX - 150, ext.maxX + 150);
  drawFaces(ctx, V, pr);
  drawLevels(ctx, V, ext.minX, ext.maxX);
  if (title) text(ctx, fc.label, rect.x + rect.w / 2, V.oy + 60 * u + store.doc.settings.floorAboveGround * scale, { size: 12, u, bold: true });
}

export function drawFacadesGrid(ctx, W, H, u, scaleOverride = null) {
  const exts = FACADES.map((fc) => projectedExtents(facadeFrame(fc)));
  if (exts.some((e) => !e)) return false;
  const cellW = W / 2, cellH = H / 2;
  const maxW = Math.max(...exts.map((e) => e.maxX - e.minX)) + 300;
  const maxH = Math.max(...exts.map((e) => e.maxZ - e.minZ)) + 220;
  const scale = scaleOverride || Math.min((cellW - 140 * u) / maxW, (cellH - 60 * u) / maxH);
  FACADES.forEach((fc, i) => drawFacade(ctx, fc, { x: (i % 2) * cellW, y: Math.floor(i / 2) * cellH, w: cellW, h: cellH }, scale, u));
  return scale;
}

export function facadesFitScale(W, H, u) {
  const exts = FACADES.map((fc) => projectedExtents(facadeFrame(fc)));
  if (exts.some((e) => !e)) return null;
  const maxW = Math.max(...exts.map((e) => e.maxX - e.minX)) + 300;
  const maxH = Math.max(...exts.map((e) => e.maxZ - e.minZ)) + 220;
  return { maxW, maxH };
}

// ---------- Coupe ----------
export function sectionExtents() {
  const sec = store.doc.section;
  if (!sec) return null;
  return projectedExtents(sectionFrame(sec), true);
}

export function drawSection(ctx, rect, scale, u, title = true) {
  const d = store.doc;
  const sec = d.section;
  if (!sec) return false;
  const frame = sectionFrame(sec);
  const ext = projectedExtents(frame, true);
  if (!ext) return false;
  const V = { scale, u, ox: rect.x + rect.w / 2 - ((ext.minX + ext.maxX) / 2) * scale, oy: rect.y + rect.h / 2 + ((ext.minZ + ext.maxZ) / 2) * scale };
  const SX = (X) => V.ox + X * scale, SZ = (Z) => V.oy - Z * scale;
  const pr = project(buildFaces(), frame, true);
  drawGround(ctx, V, ext.minX - 150, ext.maxX + 150);
  drawFaces(ctx, V, pr);

  const fa = d.settings.floorAboveGround, slabT = d.settings.slabThickness || 20;
  const cutRect = (x0, x1, z0, z1, fill = '#1e1e1e') => {
    ctx.fillStyle = fill;
    ctx.fillRect(SX(Math.min(x0, x1)), SZ(Math.max(z0, z1)), Math.abs(x1 - x0) * scale, Math.abs(z1 - z0) * scale);
  };
  // intervalles [a,b] privés des intervalles « trous »
  const minus = (ivs, holes) => {
    let out = ivs;
    for (const [h0, h1] of holes) out = out.flatMap(([a, b]) => (h1 <= a || h0 >= b ? [[a, b]] : [[a, Math.min(b, h0)], [Math.max(a, h1), b]].filter(([x, y]) => y - x > 0.5)));
    return out;
  };
  const pairs = (ps) => { const r = []; for (let i = 0; i + 1 < ps.length; i += 2) r.push([ps[i], ps[i + 1]]); return r; };
  const info = levelInfo();
  for (const L of info) {
    const lv = L.level, z0 = L.z0;
    const { geoms: G, topo: T, rooms } = levelData(lv);
    // Dalle (rez-de-chaussée) ou plancher d'étage, percé par les trémies
    const zA = L.index === 0 ? -fa : z0 - slabT;
    const holes = L.index === 0 ? [] : rooms.filter((r) => r.inner && !r.dup && isVoidRoom(r.room.name)).flatMap((r) => pairs(linePolyParams(frame.O, frame.u, r.inner)));
    for (const fp of T.footprints) {
      for (const [a, b] of minus(pairs(linePolyParams(frame.O, frame.u, fp.outer)), holes)) {
        cutRect(a, b, zA, z0, '#5a5a5a');
        ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 0.8 * u;
        ctx.strokeRect(SX(a), SZ(z0), (b - a) * scale, (z0 - zA) * scale);
      }
    }
    // Plafond sous combles (isolation) entre murs, au dernier niveau
    if (L.index === info.length - 1 && d.roofs.some((r) => r.type !== 'plat')) {
      for (const rm of T.rooms) {
        for (const [a, b] of pairs(linePolyParams(frame.O, frame.u, rm.inner))) {
          const H = L.top;
          ctx.fillStyle = '#e9e1c8'; ctx.fillRect(SX(a), SZ(H + 20), (b - a) * scale, 20 * scale);
          ctx.strokeStyle = '#555'; ctx.lineWidth = 0.6 * u; ctx.strokeRect(SX(a), SZ(H + 20), (b - a) * scale, 20 * scale);
        }
      }
    }
    // Murs coupés
    for (const w of lv.walls) {
      const g = G.get(w.id);
      if (!g) continue;
      const ps = linePolyParams(frame.O, frame.u, wallPoly(g));
      if (ps.length < 2) continue;
      const x0 = ps[0], x1 = ps[ps.length - 1];
      const X = lineIntersect(frame.O, frame.u, g.a, g.d);
      const s = X ? dot(sub(X, g.a), g.d) : -1;
      let ranges = [[0, w.height]];
      const op = lv.openings.find((o) => o.wallId === w.id && s >= o.pos - o.width / 2 && s <= o.pos + o.width / 2);
      if (op) {
        ranges = [[0, op.sill], [op.sill + op.height, w.height]].filter((r) => r[1] - r[0] > 0.5);
        const def = OPENING_TYPES[op.type];
        ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 0.7 * u;
        const xm = (x0 + x1) / 2;
        if (def.kind !== 'garage') {
          line(ctx, { x: SX(xm - 2), y: SZ(z0 + op.sill) }, { x: SX(xm - 2), y: SZ(z0 + op.sill + op.height) });
          line(ctx, { x: SX(xm + 2), y: SZ(z0 + op.sill) }, { x: SX(xm + 2), y: SZ(z0 + op.sill + op.height) });
        }
      }
      for (const [a, b] of ranges) cutRect(x0, x1, z0 + a, z0 + b, w.type === 'ext' ? '#1e1e1e' : '#4a4a4a');
    }
  }
  // Toiture coupée
  for (const r of d.roofs) {
    const geo = roofGeometry(r);
    for (const f of geo.faces) {
      if (f.kind !== 'roof' && f.kind !== 'flat') continue;
      const P = f.pts.map((p) => ({ X: (p.x - frame.O.x) * frame.u.x + (p.y - frame.O.y) * frame.u.y, Z: p.z, D: (p.x - frame.O.x) * frame.v.x + (p.y - frame.O.y) * frame.v.y }));
      const hits = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if ((a.D >= 0) !== (b.D >= 0)) { const t = a.D / (a.D - b.D); hits.push({ X: a.X + (b.X - a.X) * t, Z: a.Z + (b.Z - a.Z) * t }); }
      }
      if (hits.length < 2) continue;
      hits.sort((a, b) => a.X - b.X);
      const p0 = hits[0], p1 = hits[hits.length - 1];
      const th = f.kind === 'flat' ? 30 : 28;
      ctx.beginPath();
      ctx.moveTo(SX(p0.X), SZ(p0.Z)); ctx.lineTo(SX(p1.X), SZ(p1.Z));
      ctx.lineTo(SX(p1.X), SZ(p1.Z - th)); ctx.lineTo(SX(p0.X), SZ(p0.Z - th)); ctx.closePath();
      ctx.fillStyle = '#6b3a22'; ctx.fill();
      ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 0.8 * u; ctx.stroke();
    }
  }
  drawLevels(ctx, V, ext.minX, ext.maxX);
  if (title) text(ctx, `Coupe ${sec.label || 'A'}-${sec.label || 'A'}`, rect.x + rect.w / 2, SZ(-fa) + 46 * u, { size: 12, u, bold: true });
  return true;
}

export { heights };
