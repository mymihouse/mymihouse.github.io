// Géométrie 2D de base (unités : cm, repère plan : x vers la droite, y vers le bas)
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const neg = (a) => ({ x: -a.x, y: -a.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a) => ({ x: -a.y, y: a.x });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clone = (p) => ({ x: p.x, y: p.y });
export const rot = (p, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };

export function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const tRaw = L2 ? dot(sub(p, a), ab) / L2 : 0;
  const t = Math.max(0, Math.min(1, tRaw));
  const point = add(a, mul(ab, t));
  return { t, tRaw, point, d: dist(p, point) };
}

export function distToLine(p, a, b) {
  const d = norm(sub(b, a));
  return Math.abs(cross(d, sub(p, a)));
}

// Intersection de deux droites p + s·d et q + u·e
export function lineIntersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(q, p), e) / den;
  return add(p, mul(d, s));
}

export function segIntersect(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: add(a, mul(r, t)), t, u };
}

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}
export const area = (poly) => Math.abs(signedArea(poly));

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolyEdges(p, poly) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) m = Math.min(m, projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]).d);
  return m;
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Décalage d'un polygone : dists[i] = décalage de l'arête i vers perp(direction)
export function offsetPolygon(poly, dists) {
  const n = poly.length;
  if (n < 3) return poly.map(clone);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = norm(sub(b, a));
    const o = Array.isArray(dists) ? dists[i] : dists;
    lines.push({ p: add(a, mul(perp(d), o)), d, o });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    let q = lineIntersect(L1.p, L1.d, L2.p, L2.d);
    const maxo = Math.max(Math.abs(L1.o), Math.abs(L2.o));
    if (!q || dist(q, poly[i]) > maxo * 6 + 1) q = add(poly[i], mul(perp(L2.d), L2.o));
    out.push(q);
  }
  return out;
}

// Supprime les sommets doublons / alignés. keep(i) peut empêcher une suppression.
export function simplifyPoly(poly, extra = null) {
  let pts = poly.map((p, i) => ({ p, e: extra ? extra[i] : null }));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length], cur = pts[i], next = pts[(i + 1) % pts.length];
      if (dist(prev.p, cur.p) < 0.5) { pts.splice(i, 1); changed = true; break; }
      const d1 = norm(sub(cur.p, prev.p)), d2 = norm(sub(next.p, cur.p));
      const sameExtra = !extra || Math.abs((prev.e ?? 0) - (cur.e ?? 0)) < 0.01;
      if (Math.abs(cross(d1, d2)) < 1e-3 && dot(d1, d2) > 0 && sameExtra) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return { poly: pts.map((x) => x.p), extra: pts.map((x) => x.e) };
}

export function interiorPoint(poly) {
  const c = centroid(poly);
  if (pointInPoly(c, poly) && distToPolyEdges(c, poly) > 5) return c;
  const b = bbox(poly);
  let best = c, bestD = -1;
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const p = { x: b.minX + (b.w * i) / 24, y: b.minY + (b.h * j) / 24 };
    if (!pointInPoly(p, poly)) continue;
    const d = distToPolyEdges(p, poly);
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

// Boîte englobante orientée (teste l'orientation de chaque arête)
export function orientedBox(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (dist(a, b) < 1) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const r = poly.map((p) => rot(p, -ang));
    const bb = bbox(r);
    const ar = bb.w * bb.h;
    if (!best || ar < best.ar - 1e-6) {
      const c = rot({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 }, ang);
      best = { ar, cx: c.x, cy: c.y, w: bb.w, h: bb.h, angle: (ang * 180) / Math.PI };
    }
  }
  if (!best) return null;
  // normalise l'angle dans ]-90, 90]
  while (best.angle > 90) best.angle -= 180;
  while (best.angle <= -90) best.angle += 180;
  return best;
}

// Paramètres U où la droite O + U·u coupe le polygone (triés)
export function linePolyParams(O, u, poly) {
  const res = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = cross(u, e);
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, O);
    const U = cross(w, e) / den;
    const s = cross(w, u) / den;
    if (s >= -1e-9 && s < 1 - 1e-9) res.push(U);
  }
  res.sort((x, y) => x - y);
  return res;
}

export function fmtNum(v, dec = 2) {
  return v.toFixed(dec).replace('.', ',');
}
