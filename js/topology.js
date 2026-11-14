// Analyse topologique des murs : détection automatique des pièces et du contour du bâtiment
import { dist, sub, cross, projectOnSegment, segIntersect, signedArea, offsetPolygon, simplifyPoly, lerp } from './geom.js';

const TOL = 1;

export function buildTopology(walls) {
  const nodes = [];
  const nodeId = (p) => {
    for (let i = 0; i < nodes.length; i++) if (Math.abs(nodes[i].x - p.x) <= TOL && Math.abs(nodes[i].y - p.y) <= TOL) return i;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };
  const valid = walls.filter((w) => dist(w.a, w.b) >= 1);

  // Extrémités "effectives" : une extrémité posée dans l'épaisseur d'un autre mur est ramenée sur son axe
  const eff = valid.map((w) => [w.a, w.b].map((p) => {
    for (const o of valid) {
      if (o === w) continue;
      const L = dist(o.a, o.b);
      const pr = projectOnSegment(p, o.a, o.b);
      if (pr.d <= Math.max(TOL, o.thickness / 2 + 0.5) && pr.t * L > TOL && (1 - pr.t) * L > TOL) return pr.point;
    }
    return p;
  }));

  const splits = valid.map(() => [0, 1]);
  for (let i = 0; i < valid.length; i++) {
    const A = eff[i][0], B = eff[i][1];
    const L = dist(A, B);
    for (let j = 0; j < valid.length; j++) {
      if (i === j) continue;
      for (const p of eff[j]) {
        const pr = projectOnSegment(p, A, B);
        if (pr.d <= TOL && pr.t * L > TOL && (1 - pr.t) * L > TOL) splits[i].push(pr.t);
      }
      if (i < j) {
        const X = segIntersect(A, B, eff[j][0], eff[j][1]);
        if (X && X.t > 1e-3 && X.t < 1 - 1e-3 && X.u > 1e-3 && X.u < 1 - 1e-3) { splits[i].push(X.t); splits[j].push(X.u); }
      }
    }
  }

  const edgeMap = new Map();
  valid.forEach((w, i) => {
    const ts = [...new Set(splits[i].map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const u = nodeId(lerp(eff[i][0], eff[i][1], ts[k]));
      const v = nodeId(lerp(eff[i][0], eff[i][1], ts[k + 1]));
      if (u === v) continue;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { u, v, wall: w });
    }
  });
  let edges = [...edgeMap.values()];

  // Suppression des murs "pendants" (non fermés)
  let pruned = true;
  while (pruned) {
    pruned = false;
    const deg = new Map();
    for (const e of edges) { deg.set(e.u, (deg.get(e.u) || 0) + 1); deg.set(e.v, (deg.get(e.v) || 0) + 1); }
    const keep = edges.filter((e) => deg.get(e.u) > 1 && deg.get(e.v) > 1);
    if (keep.length !== edges.length) { edges = keep; pruned = true; }
  }

  // Demi-arêtes et parcours des faces
  const out = new Map();
  const half = [];
  for (const e of edges) {
    const h1 = { from: e.u, to: e.v, wall: e.wall }, h2 = { from: e.v, to: e.u, wall: e.wall };
    h1.twin = h2; h2.twin = h1;
    for (const h of [h1, h2]) {
      const a = nodes[h.from], b = nodes[h.to];
      h.angle = Math.atan2(b.y - a.y, b.x - a.x);
      half.push(h);
      if (!out.has(h.from)) out.set(h.from, []);
      out.get(h.from).push(h);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.angle - b.angle);

  const faces = [];
  for (const h0 of half) {
    if (h0.visited) continue;
    const loop = [];
    let h = h0, guard = 0;
    do {
      h.visited = true;
      loop.push(h);
      const list = out.get(h.to);
      const idx = list.indexOf(h.twin);
      h = list[(idx - 1 + list.length) % list.length];
      if (++guard > 10000) break;
    } while (h !== h0);
    const pts = loop.map((x) => ({ x: nodes[x.from].x, y: nodes[x.from].y }));
    const thick = loop.map((x) => x.wall.thickness);
    const wallsOf = loop.map((x) => x.wall);
    if (pts.length < 3) continue;
    faces.push({ pts, thick, walls: wallsOf, sa: signedArea(pts) });
  }

  // Dans ce parcours, les pièces fermées ont une aire signée positive, les contours extérieurs négative
  const rooms = [], footprints = [];
  for (const f of faces) {
    if (Math.abs(f.sa) < 100) continue;
    const s = simplifyPoly(f.pts, f.thick);
    const pts = s.poly, thick = s.extra;
    const sa = signedArea(pts);
    if (f.sa > 0) {
      const inner = offsetPolygon(pts, thick.map((t) => (sa > 0 ? 1 : -1) * t / 2));
      rooms.push({ center: pts, inner, thick });
    } else {
      const outer = offsetPolygon(pts, thick.map((t) => (sa > 0 ? -1 : 1) * t / 2));
      footprints.push({ center: pts, outer, thick, saC: sa });
    }
  }
  return { nodes, edges, rooms, footprints };
}
