// Géométrie des murs : jonctions en onglet, tronçons autour des ouvertures
import { add, sub, mul, dot, cross, dist, norm, perp, neg, lineIntersect, projectOnSegment } from './geom.js';

export const OPENING_TYPES = {
  porte:        { label: 'Porte intérieure', short: 'Porte', width: 83, height: 204, sill: 0, kind: 'door' },
  entree:       { label: "Porte d'entrée", short: 'Entrée', width: 90, height: 215, sill: 0, kind: 'door' },
  fenetre:      { label: 'Fenêtre', short: 'Fenêtre', width: 120, height: 125, sill: 95, kind: 'window' },
  petite:       { label: 'Petite fenêtre', short: 'Fenêtre', width: 60, height: 75, sill: 140, kind: 'window' },
  porteFenetre: { label: 'Porte-fenêtre', short: 'P.-fenêtre', width: 120, height: 215, sill: 0, kind: 'french' },
  baie:         { label: 'Baie coulissante', short: 'Baie', width: 240, height: 215, sill: 0, kind: 'slider' },
  garage:       { label: 'Porte de garage', short: 'Garage', width: 240, height: 200, sill: 0, kind: 'garage' },
};
export const isPassable = (o) => ['door', 'french', 'slider', 'garage'].includes(OPENING_TYPES[o.type]?.kind) && o.sill < 30;

const NODE_TOL = 0.6;

function awayDir(w, atA) { return atA ? norm(sub(w.b, w.a)) : norm(sub(w.a, w.b)); }

function endCaps(w, atA, walls) {
  const node = atA ? w.a : w.b;
  const away = awayDir(w, atA);
  const t = w.thickness;
  const L = perp(away);
  const flat = (ext) => ({
    left: add(add(node, mul(away, -ext)), mul(L, t / 2)),
    right: add(add(node, mul(away, -ext)), mul(L, -t / 2)),
  });

  const nb = [];
  let teeExt = 0;
  for (const o of walls) {
    if (o === w || dist(o.a, o.b) < 1) continue;
    if (dist(o.a, node) <= NODE_TOL) nb.push({ w: o, e: awayDir(o, true) });
    else if (dist(o.b, node) <= NODE_TOL) nb.push({ w: o, e: awayDir(o, false) });
    else {
      const pr = projectOnSegment(node, o.a, o.b);
      const Lo = dist(o.a, o.b);
      if (pr.d <= o.thickness / 2 + 1 && pr.t * Lo > 1 && (1 - pr.t) * Lo > 1) {
        // Jonction en T : prolonger jusqu'à l'axe + demi-épaisseur de l'autre mur
        teeExt = Math.max(teeExt, o.thickness / 2);
      }
    }
  }
  if (!nb.length) return flat(teeExt);
  const collinear = nb.filter((x) => Math.abs(cross(away, x.e)) < 0.02 && dot(away, x.e) < 0);
  const others = nb.filter((x) => !collinear.includes(x));
  const maxOther = others.reduce((m, x) => Math.max(m, x.w.thickness), 0);
  if (collinear.length) return flat(maxOther / 2);
  if (others.some((x) => x.w.thickness > t + 0.1)) return flat(maxOther / 2);
  const same = others.filter((x) => Math.abs(x.w.thickness - t) < 0.5);
  if (same.length !== 1) return flat(maxOther / 2);
  const o = same[0];
  const Lo = perp(o.e), to = o.w.thickness;
  const myLeft = add(node, mul(L, t / 2)), myRight = add(node, mul(L, -t / 2));
  const nbLeft = add(node, mul(Lo, to / 2)), nbRight = add(node, mul(Lo, -to / 2));
  const left = lineIntersect(myLeft, away, nbRight, o.e);
  const right = lineIntersect(myRight, away, nbLeft, o.e);
  if (!left || !right || dist(left, node) > 5 * t || dist(right, node) > 5 * t) return flat(maxOther / 2);
  return { left, right };
}

// Calcule la géométrie de tous les murs
export function computeWallGeoms(walls) {
  const map = new Map();
  for (const w of walls) {
    const L = dist(w.a, w.b);
    if (L < 0.5) continue;
    const d = norm(sub(w.b, w.a));
    const n = perp(d);
    const A = endCaps(w, true, walls);
    const B = endCaps(w, false, walls);
    // à l'extrémité b, la "gauche" de la direction sortante correspond au côté -n
    map.set(w.id, { a: w.a, b: w.b, d, n, L, t: w.thickness, AL: A.left, AR: A.right, BL: B.right, BR: B.left });
  }
  return map;
}

export function wallPoly(g) { return [g.AL, g.BL, g.BR, g.AR]; }

export function pointOnWall(g, s, side = 0) {
  return add(add(g.a, mul(g.d, s)), mul(g.n, (side * g.t) / 2));
}

export function piecePoly(g, s0, s1) {
  const e = 0.01;
  const pL0 = s0 <= e ? g.AL : pointOnWall(g, s0, 1);
  const pR0 = s0 <= e ? g.AR : pointOnWall(g, s0, -1);
  const pL1 = s1 >= g.L - e ? g.BL : pointOnWall(g, s1, 1);
  const pR1 = s1 >= g.L - e ? g.BR : pointOnWall(g, s1, -1);
  return [pL0, pL1, pR1, pR0];
}

export function openingRange(o, g) {
  const s0 = Math.max(0, o.pos - o.width / 2), s1 = Math.min(g.L, o.pos + o.width / 2);
  return [s0, s1];
}

// Tronçons de mur (en plan et en hauteur) autour des ouvertures
export function wallPieces(w, g, openings) {
  const H = w.height;
  const ops = openings.filter((o) => o.wallId === w.id).sort((a, b) => a.pos - b.pos);
  const pieces = [];
  let cur = 0;
  for (const o of ops) {
    const [s0, s1] = openingRange(o, g);
    if (s1 <= cur + 0.1) continue;
    const a0 = Math.max(s0, cur);
    if (a0 > cur + 0.1) pieces.push({ s0: cur, s1: a0, z0: 0, z1: H });
    const top = Math.min(H, o.sill + o.height);
    if (o.sill > 0.1) pieces.push({ s0: a0, s1, z0: 0, z1: Math.min(o.sill, H), below: true });
    if (top < H - 0.1) pieces.push({ s0: a0, s1, z0: top, z1: H, above: true });
    cur = s1;
  }
  if (cur < g.L - 0.1 || !pieces.length) pieces.push({ s0: cur, s1: g.L, z0: 0, z1: H });
  for (const p of pieces) p.poly = piecePoly(g, p.s0, p.s1);
  return pieces;
}

export function clampOpening(o, g) {
  const minPos = o.width / 2 + Math.min(10, g.t / 2);
  const maxPos = g.L - o.width / 2 - Math.min(10, g.t / 2);
  if (maxPos < minPos) o.pos = g.L / 2;
  else o.pos = Math.max(minPos, Math.min(maxPos, o.pos));
}

export function wallsAtNode(walls, p, tol = NODE_TOL) {
  const res = [];
  for (const w of walls) {
    if (dist(w.a, p) <= tol) res.push({ w, end: 'a' });
    if (dist(w.b, p) <= tol) res.push({ w, end: 'b' });
  }
  return res;
}

export { neg };
