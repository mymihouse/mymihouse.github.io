// MymiHouseBoucletteBuilder — interface principale
import { store, on, emit, uid, checkpoint, dropCheckpoint, undo, redo, newProject, loadDoc, loadAutosave, syncRooms, syncAllRooms, topo, wallGeoms, resolvedRooms, stats, fmtLen, ROOM_NAMES, FLOORS, outsideSide, activeLevel, levelInfo, levelData, newLevel, levelName, bindDoc, ghostLevel, roofLevelIndex } from './model.js';
import * as G from './geom.js';
import { OPENING_TYPES, clampOpening, wallsAtNode, pointOnWall, wallPoly, openingRange } from './walls.js';
import { FURNITURE, FURNITURE_CATS } from './furniture.js';
import { ROOF_TYPES, roofFromFootprint, roofGeometry } from './roof.js';
import { JOINERY_MATERIALS, JOINERY_COLORS, FINISHES, joinery, wallFinish } from './joinery.js';
import { drawPlan, planExtents, text, line, makeS, pathPoly, dimWorld } from './render2d.js';
import { drawFacadesGrid, facadesFitScale, drawSection, sectionExtents } from './elev.js';
import { drawMasse, masseExtents } from './masse.js';
import { init3D, setActive, markDirty, startWalk, toggleRoof, toggleCutaway, snapshot, offscreenSnapshot, resetFrame } from './view3d.js';
import { exportPDF, exportPNG, renderPage } from './export.js';
import { buildExample } from './example.js';
import { initAssistant } from './assistant.js';
import { importBackground, setBackgroundLoadedCallback, backgroundCorners, drawBackground } from './background.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const canvas = $('#plan'), ctx = canvas.getContext('2d');
const stage = $('#stage'), pbody = $('#pbody'), hintEl = $('#hint'), lenInput = $('#lenInput');

const ui = {
  view: 'plan', tool: 'select', openingType: 'porte', furnType: null, furnRot: 0, ptab: 'props',
  V: { scale: 0.5, ox: 120, oy: 120, w: 800, h: 600, u: 1 },
  sub: { facades: { z: 1, px: 0, py: 0 }, coupe: { z: 1, px: 0, py: 0 } },
  mouse: null, snap: null, draft: null, drag: null, hover: null, shift: false, space: false, dpr: 1,
};
const HINTS = {
  select: 'Cliquez pour sélectionner, glissez pour déplacer. Glissez sur le vide pour déplacer la vue. Suppr pour supprimer.',
  wallExt: 'Cliquez point par point pour tracer les murs extérieurs. Tapez une longueur puis Entrée pour une cote exacte. Double-clic ou Entrée pour terminer.',
  wallInt: 'Cliquez point par point pour tracer les cloisons. Elles s’accrochent aux murs existants. Double-clic ou Entrée pour terminer.',
  rect: 'Tirez un rectangle pour créer une pièce (4 murs).',
  opening: 'Survolez un mur et cliquez pour poser l’ouverture.',
  furniture: 'Cliquez pour poser le meuble. R pour le faire pivoter. Échap pour annuler.',
  dim: 'Cliquez le 1er point, le 2e point, puis placez la ligne de cote.',
  parcel: 'Cliquez les coins du terrain. Double-clic ou Entrée pour fermer la parcelle.',
  section: 'Cliquez 2 points pour tracer la ligne de coupe.',
  calib: 'Cliquez 2 points du fond de plan dont vous connaissez la distance réelle, puis tapez cette distance et Entrée.',
};

// ---------- Utilitaires ----------
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
const V = ui.V;
const S = (p) => ({ x: p.x * V.scale + V.ox, y: p.y * V.scale + V.oy });
function toWorld(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - V.ox) / V.scale, y: (e.clientY - r.top - V.oy) / V.scale }; }
function snapGrid(v) { const g = store.doc.settings.gridSnap || 1; return Math.round(v / g) * g; }
function parseLen(s) { s = String(s).trim().replace(',', '.'); if (!s) return null; const v = parseFloat(s); if (isNaN(v)) return null; return /m$/i.test(s) || s.includes('.') || v < 30 ? v * 100 : v; }
const norm180 = (a) => { while (a > 180) a -= 360; while (a <= -180) a += 360; return a; };

// ---------- Vue ----------
function resizeCanvas() {
  const r = stage.getBoundingClientRect();
  ui.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * ui.dpr); canvas.height = Math.round(r.height * ui.dpr);
  V.w = r.width; V.h = r.height;
  render();
}
function fitView(ext, pad = 60) {
  if (!ext) { V.scale = 0.5; V.ox = V.w / 2; V.oy = V.h / 2; return; }
  const w = ext.maxX - ext.minX || 100, h = ext.maxY - ext.minY || 100;
  V.scale = Math.min((V.w - pad * 2) / w, (V.h - pad * 2) / h);
  V.scale = Math.max(0.02, Math.min(10, V.scale));
  V.ox = V.w / 2 - ((ext.minX + ext.maxX) / 2) * V.scale;
  V.oy = V.h / 2 - ((ext.minY + ext.maxY) / 2) * V.scale;
}
function fitCurrent() {
  if (ui.view === 'plan') fitView(planExtents(true) || { minX: -600, minY: -500, maxX: 600, maxY: 500 });
  else if (ui.view === 'masse') fitView(masseExtents() || planExtents(true) || { minX: -600, minY: -500, maxX: 600, maxY: 500 }, 40);
  else if (ui.view === 'facades' || ui.view === 'coupe') ui.sub[ui.view] = { z: 1, px: 0, py: 0 };
  render();
}
function zoomAt(factor, sx, sy) {
  if (ui.view === 'facades' || ui.view === 'coupe') {
    const s = ui.sub[ui.view];
    const nz = Math.max(0.3, Math.min(8, s.z * factor));
    const k = nz / s.z;
    s.px = sx - (sx - s.px) * k; s.py = sy - (sy - s.py) * k; s.z = nz;
  } else {
    const ns = Math.max(0.02, Math.min(12, V.scale * factor));
    const k = ns / V.scale;
    V.ox = sx - (sx - V.ox) * k; V.oy = sy - (sy - V.oy) * k; V.scale = ns;
  }
  render();
}

// ---------- Rendu ----------
function render() {
  ctx.setTransform(ui.dpr, 0, 0, ui.dpr, 0, 0);
  const msg = $('#stageMsg');
  msg.style.display = 'none';
  if (ui.view === 'plan') {
    drawPlan(ctx, V, { overlay: drawOverlay });
    // Contrôle de calage (?bgtop) : le fond est redessiné par-dessus le plan
    if (location.search.includes('bgtop') && store.doc.background) { ctx.save(); drawBackground(ctx, S, V, { ...store.doc.background, opacity: 0.5, locked: true }, false); ctx.restore(); }
    if (!store.doc.walls.length && !ui.draft) { msg.style.display = 'flex'; msg.textContent = 'Choisissez « Mur extérieur » à gauche et cliquez sur le plan pour commencer, ou ouvrez l’exemple.'; }
  } else if (ui.view === 'masse') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, V.w, V.h);
    drawMasse(ctx, V);
    if (!store.doc.parcel) { msg.style.display = 'flex'; msg.textContent = 'Tracez d’abord la parcelle (outil « Parcelle » dans la vue Plan) pour obtenir le plan de masse.'; }
  } else if (ui.view === 'facades') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, V.w, V.h);
    const s = ui.sub.facades;
    ctx.setTransform(ui.dpr, 0, 0, ui.dpr, s.px * ui.dpr, s.py * ui.dpr);
    const ok = drawFacadesGrid(ctx, V.w * s.z, V.h * s.z, 1);
    if (!ok) { msg.style.display = 'flex'; msg.textContent = 'Dessinez des murs fermés pour voir les façades.'; }
  } else if (ui.view === 'coupe') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, V.w, V.h);
    const ext = sectionExtents();
    if (!ext) { msg.style.display = 'flex'; msg.textContent = store.doc.section ? 'La ligne de coupe ne traverse aucun mur.' : 'Tracez une ligne de coupe sur le plan (outil « Ligne de coupe »).'; }
    else {
      const s = ui.sub.coupe;
      ctx.setTransform(ui.dpr, 0, 0, ui.dpr, s.px * ui.dpr, s.py * ui.dpr);
      const W = V.w * s.z, H = V.h * s.z;
      const scale = Math.min((W - 220) / (ext.maxX - ext.minX + 300), (H - 160) / (ext.maxZ - ext.minZ + 200));
      drawSection(ctx, { x: 0, y: 0, w: W, h: H }, scale, 1, true);
    }
  }
  updateFooter();
}

function drawOverlay(c, V, S) {
  const u = 1, d = store.doc, sel = store.selection;
  // Poignées de sélection
  if (sel) {
    c.fillStyle = '#fff'; c.strokeStyle = '#1a73e8'; c.lineWidth = 1.5;
    const handle = (p) => { const q = S(p); c.beginPath(); c.rect(q.x - 5, q.y - 5, 10, 10); c.fill(); c.stroke(); };
    const o = selected();
    if (sel.type === 'wall' && o) { handle(o.a); handle(o.b); }
    if (sel.type === 'dim' && o) { handle(o.a); handle(o.b); }
    if (sel.type === 'section' && o) { handle(o.a); handle(o.b); }
    if (sel.type === 'parcel' && o) o.pts.forEach(handle);
    if (sel.type === 'furniture' && o) {
      c.save(); const q = S(o); c.translate(q.x, q.y); c.rotate((o.rot * Math.PI) / 180);
      c.setLineDash([4, 3]); c.strokeRect((-o.w / 2) * V.scale - 3, (-o.d / 2) * V.scale - 3, o.w * V.scale + 6, o.d * V.scale + 6); c.restore();
    }
    if (sel.type === 'roof' && o) { const r = o; const ang = (r.angle * Math.PI) / 180; handle(G.add({ x: r.cx, y: r.cy }, G.rot({ x: r.length / 2, y: 0 }, ang))); handle(G.add({ x: r.cx, y: r.cy }, G.rot({ x: 0, y: r.width / 2 }, ang))); handle({ x: r.cx, y: r.cy }); }
  }
  // Survol
  if (ui.hover && ui.tool === 'select' && !ui.drag && (!sel || sel.id !== ui.hover.id)) {
    const h = ui.hover;
    c.strokeStyle = 'rgba(26,115,232,.55)'; c.lineWidth = 2;
    if (h.type === 'wall') { const g = wallGeoms().get(h.id); if (g) { pathPoly(c, wallPoly(g), S); c.stroke(); } }
    if (h.type === 'room') { const r = resolvedRooms().find((x) => x.room.id === h.id); if (r?.inner) { pathPoly(c, r.inner, S); c.stroke(); } }
  }
  // Brouillons
  const dr = ui.draft, m = ui.snap?.p || ui.mouse;
  if (dr && m) {
    if (dr.kind === 'wall' && dr.last) {
      const th = dr.type === 'ext' ? d.settings.extThickness : d.settings.intThickness;
      const dir = G.norm(G.sub(m, dr.last)), n = G.perp(dir);
      const poly = [G.add(dr.last, G.mul(n, th / 2)), G.add(m, G.mul(n, th / 2)), G.add(m, G.mul(n, -th / 2)), G.add(dr.last, G.mul(n, -th / 2))];
      pathPoly(c, poly, S); c.fillStyle = 'rgba(26,115,232,.25)'; c.fill(); c.strokeStyle = '#1a73e8'; c.lineWidth = 1; c.stroke();
      const L = G.dist(dr.last, m);
      if (L > 1) {
        dimWorld(c, S, u, dr.last, m, G.mul(n, -(th / 2 + 40)), fmtLen(L) + (d.settings.dimUnit === 'm' ? ' m' : ' cm'), '#1a73e8', 11);
        const ang = Math.round(norm180((Math.atan2(-(m.y - dr.last.y), m.x - dr.last.x) * 180) / Math.PI));
        const q = S(m); text(c, `${fmtLen(L)} ${d.settings.dimUnit} · ${ang}°`, q.x + 14, q.y - 14, { size: 11, bold: true, color: '#1a73e8', bg: 'rgba(255,255,255,.9)', align: 'left' });
      }
    }
    if (dr.kind === 'furn') drawFurnGhost(c, S, V, dr, m);
    if (dr.kind === 'dim') {
      c.strokeStyle = '#1a73e8';
      if (dr.pts.length === 1) { line(c, S(dr.pts[0]), S(m)); }
      if (dr.pts.length === 2) { const dir = G.norm(G.sub(dr.pts[1], dr.pts[0])); const off = G.dot(G.sub(m, dr.pts[0]), G.perp(dir)); dimWorld(c, S, u, dr.pts[0], dr.pts[1], G.mul(G.perp(dir), off), undefined, '#1a73e8'); }
    }
    if (dr.kind === 'parcel') {
      c.strokeStyle = '#3d7a2f'; c.lineWidth = 1.5; c.setLineDash([10, 4]);
      pathPoly(c, [...dr.pts, m], S, false); c.stroke(); c.setLineDash([]);
      if (dr.pts.length) { const L = G.dist(dr.pts[dr.pts.length - 1], m); const q = S(m); text(c, `${fmtLen(L)} ${d.settings.dimUnit}`, q.x + 12, q.y - 12, { size: 11, color: '#3d7a2f', bg: 'rgba(255,255,255,.9)', align: 'left' }); }
    }
    if (dr.kind === 'section' && dr.a) { c.strokeStyle = '#c0392b'; c.lineWidth = 1.5; c.setLineDash([12, 4, 3, 4]); line(c, S(dr.a), S(m)); c.setLineDash([]); }
    if (dr.kind === 'calib') {
      c.strokeStyle = '#e8710a'; c.fillStyle = '#e8710a'; c.lineWidth = 2;
      const pts = dr.pts.length < 2 ? [...dr.pts, m] : dr.pts;
      for (const q of dr.pts) { const s = S(q); c.beginPath(); c.arc(s.x, s.y, 5, 0, Math.PI * 2); c.fill(); }
      if (pts.length === 2) { line(c, S(pts[0]), S(pts[1])); const q = S(pts[1]); text(c, dr.pts.length === 2 ? 'Tapez la distance réelle dans la barre en haut' : `${fmtLen(G.dist(pts[0], pts[1]))} ${d.settings.dimUnit} (avant mise à l’échelle)`, q.x + 14, q.y - 14, { size: 11, bold: true, color: '#e8710a', bg: 'rgba(255,255,255,.9)', align: 'left' }); }
    }
  }
  if (ui.drag?.kind === 'rect') {
    const a = ui.drag.start, b = ui.drag.cur;
    const poly = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    pathPoly(c, poly, S); c.fillStyle = 'rgba(26,115,232,.12)'; c.fill(); c.strokeStyle = '#1a73e8'; c.lineWidth = 1.5; c.stroke();
    const q = S(b); text(c, `${fmtLen(Math.abs(b.x - a.x))} × ${fmtLen(Math.abs(b.y - a.y))} ${d.settings.dimUnit}`, q.x + 12, q.y + 16, { size: 11, bold: true, color: '#1a73e8', bg: 'rgba(255,255,255,.9)', align: 'left' });
  }
  // Aperçu d'ouverture
  if (ui.tool === 'opening' && ui.hoverOpening) {
    const { g, s, w } = ui.hoverOpening;
    const T = OPENING_TYPES[ui.openingType];
    const p0 = pointOnWall(g, s - T.width / 2, 1), p1 = pointOnWall(g, s + T.width / 2, 1), p2 = pointOnWall(g, s + T.width / 2, -1), p3 = pointOnWall(g, s - T.width / 2, -1);
    pathPoly(c, [p0, p1, p2, p3], S); c.fillStyle = 'rgba(26,115,232,.45)'; c.fill();
  }
  // Accrochage
  if (ui.snap && ui.tool !== 'select' && ui.snap.kind !== 'grid') {
    const q = S(ui.snap.p);
    c.strokeStyle = ui.snap.kind === 'node' ? '#e8710a' : '#1a73e8'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(q.x, q.y, 6, 0, Math.PI * 2); c.stroke();
    for (const gd of ui.snap.guides || []) { c.setLineDash([3, 3]); c.strokeStyle = 'rgba(26,115,232,.6)'; line(c, S(gd.a), S(gd.b)); c.setLineDash([]); }
  }
}
function drawFurnGhost(c, S, V, dr, m) {
  const def = FURNITURE[dr.type];
  const q = S(m);
  c.save(); c.translate(q.x, q.y); c.rotate((dr.rot * Math.PI) / 180); c.scale(V.scale, V.scale);
  c.beginPath(); def.draw(c, def.w, def.d);
  c.fillStyle = 'rgba(26,115,232,.2)'; c.fill(); c.lineWidth = 1 / V.scale; c.strokeStyle = '#1a73e8'; c.stroke();
  c.restore();
}

function updateFooter() {
  hintEl.textContent = ui.view === 'plan' ? HINTS[ui.tool] || '' : ui.view === '3d' ? 'Glisser : tourner · Molette : zoom · Clic droit : déplacer' : 'Molette : zoom · Glisser : déplacer · A : ajuster';
  if (ui.mouse && ui.view === 'plan') $('#coords').textContent = `x ${fmtLen(ui.mouse.x)}  y ${fmtLen(ui.mouse.y)} ${store.doc.settings.dimUnit}`;
  else $('#coords').textContent = '';
  $('#zoom').textContent = ui.view === 'plan' || ui.view === 'masse' ? `1 m = ${Math.round(V.scale * 100)} px` : '';
}

// ---------- Accrochage ----------
function snapPoint(p, { from = null, exclude = [] } = {}) {
  const d = store.doc, tolN = 10 / V.scale, tolW = 7 / V.scale;
  let best = null;
  const gh = ghostLevel();
  for (const w of gh ? [...d.walls, ...gh.walls] : d.walls) for (const q of [w.a, w.b]) { const dd = G.dist(p, q); if (dd < tolN && (!best || dd < best.d)) best = { p: G.clone(q), d: dd, kind: 'node' }; }
  if (best) return best;
  let q = G.clone(p);
  const guides = [];
  let angLocked = false;
  if (from) {
    const v = G.sub(p, from), L = G.len(v);
    if (L > 1) {
      const ang = Math.atan2(v.y, v.x), step = Math.PI / 12, sn = Math.round(ang / step) * step;
      if (Math.abs(sn - ang) < 0.09 || ui.shift) { q = G.add(from, { x: Math.cos(sn) * L, y: Math.sin(sn) * L }); angLocked = true; }
    }
  }
  for (const w of d.walls) {
    if (exclude.includes(w)) continue;
    const pr = G.projectOnSegment(q, w.a, w.b);
    if (pr.d < tolW && (!best || pr.d < best.d)) best = { p: pr.point, d: pr.d, kind: 'wall', wall: w };
  }
  if (best) {
    if (from && angLocked) {
      const dir = G.norm(G.sub(q, from));
      const X = G.lineIntersect(from, dir, best.wall.a, G.sub(best.wall.b, best.wall.a));
      if (X && G.projectOnSegment(X, best.wall.a, best.wall.b).d < 0.5 && G.dist(X, q) < tolW * 2) best.p = X;
    }
    return best;
  }
  let ax = null, ay = null;
  for (const w of d.walls) for (const n of [w.a, w.b]) {
    if (exclude.includes(w)) continue;
    if (Math.abs(n.x - q.x) < tolW && (!ax || Math.abs(n.x - q.x) < Math.abs(ax.x - q.x))) ax = n;
    if (Math.abs(n.y - q.y) < tolW && (!ay || Math.abs(n.y - q.y) < Math.abs(ay.y - q.y))) ay = n;
  }
  const dir = from ? G.norm(G.sub(q, from)) : null;
  const horiz = dir && Math.abs(dir.y) < 1e-6, vert = dir && Math.abs(dir.x) < 1e-6;
  if (ax && (!dir || horiz)) { q.x = ax.x; guides.push({ a: ax, b: q }); }
  if (ay && (!dir || vert)) { q.y = ay.y; guides.push({ a: ay, b: q }); }
  const g = d.settings.gridSnap;
  if (g > 0) {
    if (!dir || horiz || vert) { if (!guides.some((x) => x.a.x === q.x && ax)) q.x = snapGrid(q.x); if (!guides.some((x) => x.a.y === q.y && ay)) q.y = snapGrid(q.y); if (horiz) q.y = from.y; if (vert) q.x = from.x; }
    else { const L = snapGrid(G.dist(from, q)); q = G.add(from, G.mul(dir, L)); }
  }
  return { p: q, d: 0, kind: guides.length ? 'align' : 'grid', guides };
}

// ---------- Sélection / test de clic ----------
function selected() {
  const s = store.selection, d = store.doc;
  if (!s) return null;
  switch (s.type) {
    case 'wall': return d.walls.find((w) => w.id === s.id);
    case 'opening': return d.openings.find((o) => o.id === s.id);
    case 'furniture': return d.furniture.find((f) => f.id === s.id);
    case 'room': return d.rooms.find((r) => r.id === s.id);
    case 'dim': return d.dims.find((x) => x.id === s.id);
    case 'roof': return d.roofs.find((r) => r.id === s.id);
    case 'section': return d.section;
    case 'parcel': return d.parcel;
    case 'background': return d.background;
  }
  return null;
}
function setSelection(sel) { store.selection = sel; emit('selection'); }

function hitTest(p) {
  const d = store.doc, Gm = wallGeoms(), tol = 8 / V.scale;
  for (const o of d.openings) {
    const g = Gm.get(o.wallId); if (!g) continue;
    const [s0, s1] = openingRange(o, g);
    const pr = G.projectOnSegment(p, pointOnWall(g, s0, 0), pointOnWall(g, s1, 0));
    if (pr.d < g.t / 2 + tol) return { type: 'opening', id: o.id };
  }
  for (const f of [...d.furniture].reverse()) {
    const l = G.rot(G.sub(p, f), (-f.rot * Math.PI) / 180);
    if (Math.abs(l.x) <= f.w / 2 + 2 && Math.abs(l.y) <= f.d / 2 + 2) return { type: 'furniture', id: f.id };
  }
  for (const dm of d.dims) {
    const dir = G.norm(G.sub(dm.b, dm.a)), off = G.mul(G.perp(dir), dm.offset);
    if (G.projectOnSegment(p, G.add(dm.a, off), G.add(dm.b, off)).d < tol) return { type: 'dim', id: dm.id };
  }
  if (d.section && G.projectOnSegment(p, d.section.a, d.section.b).d < tol * 1.5) return { type: 'section', id: 'section' };
  for (const r of d.roofs) { if (roofLevelIndex(r) !== d.activeLevel) continue; const ol = roofGeometry(r).lines.outline; if (G.distToPolyEdges(p, ol) < tol) return { type: 'roof', id: r.id }; }
  for (const w of d.walls) { const g = Gm.get(w.id); if (g && (G.pointInPoly(p, wallPoly(g)) || G.projectOnSegment(p, w.a, w.b).d < Math.max(g.t / 2, tol * 0.6))) return { type: 'wall', id: w.id }; }
  for (const r of resolvedRooms()) if (r.inner && !r.dup && G.pointInPoly(p, r.inner)) return { type: 'room', id: r.room.id };
  if (d.parcel && d.parcel.pts.length > 1) { const pts = d.parcel.pts; for (let i = 0; i < pts.length; i++) if (G.projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d < tol) return { type: 'parcel', id: 'parcel' }; }
  if (d.background && !d.background.locked && d.background.visible !== false && G.pointInPoly(p, backgroundCorners(d.background))) return { type: 'background', id: 'background' };
  return null;
}

// ---------- Modification du modèle ----------
function addWall(a, b, type) {
  const d = store.doc;
  if (G.dist(a, b) < 2) return null;
  const w = { id: uid('w'), a: G.clone(a), b: G.clone(b), type, thickness: type === 'ext' ? d.settings.extThickness : d.settings.intThickness, height: activeLevel().height };
  d.walls.push(w);
  return w;
}
function afterWallsChanged() {
  const Gm = wallGeoms();
  store.doc.openings = store.doc.openings.filter((o) => { const g = Gm.get(o.wallId); if (!g) return false; clampOpening(o, g); return g.L > o.width * 0.6; });
  emit('geometry');
  syncRooms();
}
function deleteSelection() {
  const s = store.selection, d = store.doc;
  if (!s) return;
  if (s.type === 'room') { toast('Une pièce est définie par ses murs : supprimez ou déplacez les murs.'); return; }
  checkpoint();
  if (s.type === 'wall') { d.walls = d.walls.filter((w) => w.id !== s.id); d.openings = d.openings.filter((o) => o.wallId !== s.id); }
  if (s.type === 'opening') d.openings = d.openings.filter((o) => o.id !== s.id);
  if (s.type === 'furniture') d.furniture = d.furniture.filter((f) => f.id !== s.id);
  if (s.type === 'dim') d.dims = d.dims.filter((x) => x.id !== s.id);
  if (s.type === 'roof') d.roofs = d.roofs.filter((r) => r.id !== s.id);
  if (s.type === 'section') d.section = null;
  if (s.type === 'parcel') d.parcel = null;
  if (s.type === 'background') d.background = null;
  store.selection = null;
  if (s.type === 'wall') afterWallsChanged(); else emit('geometry');
}
function nearestWall(p, maxD = 60) {
  let best = null;
  for (const w of store.doc.walls) {
    const g = wallGeoms().get(w.id); if (!g) continue;
    const pr = G.projectOnSegment(p, w.a, w.b);
    if (pr.d < maxD && (!best || pr.d < best.d)) best = { w, g, s: pr.t * g.L, d: pr.d };
  }
  return best;
}
function defaultSide(wallId) { const out = outsideSide(wallId); return out ? -out : 1; }
function addRoofAuto() {
  const T = topo();
  if (!T.footprints.length) { toast('Fermez d’abord les murs extérieurs pour poser une toiture.'); return; }
  checkpoint();
  const fp = T.footprints.sort((a, b) => G.area(b.outer) - G.area(a.outer))[0];
  const box = G.orientedBox(fp.outer);
  const L = levelInfo()[store.doc.activeLevel];
  const r = roofFromFootprint(box, { wallHeight: L.top }, uid('roof'));
  r.level = L.level.id;
  store.doc.roofs.push(r);
  setSelection({ type: 'roof', id: r.id });
  emit('geometry');
  toast('Toiture 4 pans ajoutée. Réglez la pente, le débord et le type à droite.');
}

// ---------- Niveaux ----------
const anyWalls = () => store.doc.levels.some((l) => l.walls.length);
function levelTops() { const m = {}; for (const L of levelInfo()) m[L.level.id] = L.top; return m; }
// Les toitures posées sur le haut des murs d'un niveau suivent ce niveau quand les hauteurs changent
function followRoofs(before) {
  const after = levelTops();
  store.doc.roofs = store.doc.roofs.filter((r) => after[r.level] !== undefined);
  for (const r of store.doc.roofs) if (before[r.level] !== undefined && Math.abs(r.eave - before[r.level]) < 0.5) r.eave = after[r.level];
}
function setLevel(i) {
  const d = store.doc;
  if (i === d.activeLevel || i < 0 || i >= d.levels.length) return;
  if (ui.draft?.kind === 'wall') ui.draft.last = null;
  lenInput.style.display = 'none';
  d.activeLevel = i; store.selection = null; ui.hover = null; ui.hoverOpening = null;
  emit('geometry');
}
function copyExtWalls(from, to) {
  for (const w of from.walls) if (w.type === 'ext') to.walls.push({ id: uid('w'), a: G.clone(w.a), b: G.clone(w.b), type: 'ext', thickness: w.thickness, height: to.height });
}
function addLevel(above) {
  const d = store.doc, cur = activeLevel(), idx = d.activeLevel;
  const before = levelTops();
  checkpoint();
  const at = above ? idx + 1 : idx;
  const lv = newLevel(uid('N'), '', cur.height);
  copyExtWalls(cur, lv);
  const oldNames = d.levels.map((l, i) => l.name === levelName(i));
  d.levels.splice(at, 0, lv);
  oldNames.splice(at, 0, true);
  d.levels.forEach((l, i) => { if (oldNames[i]) l.name = levelName(i); });
  // la toiture du niveau courant monte sur le nouvel étage
  if (above) for (const r of d.roofs) if (r.level === cur.id) { r.level = lv.id; before[lv.id] = before[cur.id]; }
  followRoofs(before);
  d.activeLevel = at; store.selection = null;
  emit('geometry');
  syncRooms();
  toast(`« ${lv.name} » créé avec les murs extérieurs du niveau ${above ? 'du dessous' : 'du dessus'}. Ajoutez cloisons, portes et fenêtres.`, 6000);
}
function deleteLevel() {
  const d = store.doc;
  if (d.levels.length < 2) return;
  const lv = activeLevel();
  if (!confirm(`Supprimer le niveau « ${lv.name} » et tout ce qu’il contient ?`)) return;
  const before = levelTops();
  checkpoint();
  const below = d.levels[d.activeLevel - 1];
  if (below && d.activeLevel === d.levels.length - 1) for (const r of d.roofs) if (r.level === lv.id) { r.level = below.id; before[below.id] = before[lv.id]; }
  d.levels.splice(d.activeLevel, 1);
  d.activeLevel = Math.max(0, d.activeLevel - 1);
  followRoofs(before);
  store.selection = null;
  emit('geometry');
}
function moveLevel(dir) {
  const d = store.doc, i = d.activeLevel, j = i + dir;
  if (j < 0 || j >= d.levels.length) return;
  const before = levelTops();
  checkpoint();
  [d.levels[i], d.levels[j]] = [d.levels[j], d.levels[i]];
  d.activeLevel = j;
  followRoofs(before);
  emit('geometry');
}
function shiftLevel(dx, dy) {
  if (!dx && !dy) return;
  const lv = activeLevel(), v = { x: dx, y: dy };
  checkpoint();
  for (const w of lv.walls) { w.a = G.add(w.a, v); w.b = G.add(w.b, v); }
  for (const r of lv.rooms) r.seed = G.add(r.seed, v);
  for (const f of lv.furniture) { f.x += dx; f.y += dy; }
  for (const dm of lv.dims) { dm.a = G.add(dm.a, v); dm.b = G.add(dm.b, v); }
  if (lv.background) { lv.background.x += dx; lv.background.y += dy; }
  afterWallsChanged();
}
// Ajoute au projet les niveaux d'un autre fichier MymiHouseBoucletteBuilder (au-dessus des niveaux existants)
function importLevels(src) {
  const d = store.doc;
  const other = bindDoc(JSON.parse(JSON.stringify(src)));
  const before = levelTops();
  checkpoint();
  for (const o of other.levels) {
    const lv = newLevel(uid('N'), o.name === levelName(0) ? levelName(d.levels.length) : o.name, o.height);
    const ids = new Map();
    for (const w of o.walls) { const id = uid('w'); ids.set(w.id, id); lv.walls.push({ ...w, id }); }
    for (const op of o.openings) if (ids.has(op.wallId)) lv.openings.push({ ...op, id: uid('o'), wallId: ids.get(op.wallId) });
    for (const r of o.rooms) lv.rooms.push({ ...r, id: uid('r') });
    for (const f of o.furniture) lv.furniture.push({ ...f, id: uid('f') });
    for (const dm of o.dims) lv.dims.push({ ...dm, id: uid('d') });
    lv.background = o.background || null;
    d.levels.push(lv);
  }
  followRoofs(before);
  d.activeLevel = d.levels.length - 1; store.selection = null;
  emit('geometry');
  syncAllRooms();
  toast(`${other.levels.length > 1 ? other.levels.length + ' niveaux importés' : 'Niveau importé'} au-dessus. Si le niveau n’est pas aligné, utilisez « Décaler ce niveau » à droite.`, 7000);
}
function updateLevelBar() {
  const bar = $('#levelBar'), d = store.doc;
  bar.style.display = ui.view === 'plan' || ui.view === '3d' ? 'flex' : 'none';
  bar.innerHTML = d.levels.map((l, i) => `<button class="lv${i === d.activeLevel ? ' active' : ''}" data-lv="${i}" title="${l.name.replace(/"/g, '&quot;')}">${l.name.length > 20 ? l.name.slice(0, 19) + '…' : l.name}</button>`).join('') + '<button class="lv add" data-lv="add" title="Ajouter un étage au-dessus du niveau affiché">＋ Étage</button>';
}

// ---------- Outils ----------
function setTool(tool, arg = null) {
  ui.draft = null; lenInput.style.display = 'none'; ui.hoverOpening = null;
  ui.tool = tool;
  if (tool === 'opening') ui.openingType = arg;
  if (tool === 'furniture') { ui.furnType = arg; ui.furnRot = 0; ui.draft = { kind: 'furn', type: arg, rot: 0 }; }
  if (tool === 'dim') ui.draft = { kind: 'dim', pts: [] };
  if (tool === 'parcel') ui.draft = { kind: 'parcel', pts: [] };
  if (tool === 'section') ui.draft = { kind: 'section', a: null };
  if (tool === 'wallExt' || tool === 'wallInt') ui.draft = { kind: 'wall', type: tool === 'wallExt' ? 'ext' : 'int', last: null };
  if (tool === 'calib') {
    if (!store.doc.background) { toast('Importez d’abord un PDF ou une image (bouton « Importer PDF »).'); tool = 'select'; ui.tool = 'select'; }
    else ui.draft = { kind: 'calib', pts: [] };
  }
  $$('#tools .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool && (tool !== 'opening' || b.dataset.arg === arg)));
  canvas.className = tool === 'select' ? '' : 'crosshair';
  if (ui.view !== 'plan' && tool !== 'select') setView('plan');
  render();
}
function finishDraft() {
  const dr = ui.draft;
  if (!dr) return;
  if (dr.kind === 'wall') { dr.last = null; lenInput.style.display = 'none'; }
  else if (dr.kind === 'parcel') { if (dr.pts.length >= 3) { checkpoint(); store.doc.parcel = { pts: dr.pts }; setSelection({ type: 'parcel', id: 'parcel' }); emit('geometry'); toast('Parcelle créée. Voir l’onglet « Plan de masse ».'); } setTool('select'); }
  else if (dr.kind === 'dim') dr.pts = [];
  else if (dr.kind === 'section') dr.a = null;
  else if (dr.kind === 'calib') { dr.pts = []; hideCalibBar(); }
  render();
}

// ---------- Fond de plan ----------
async function importBg(file) {
  toast('Import du plan en cours…', 8000);
  try {
    const r = await importBackground(file, (n) => parseInt(prompt(`Ce PDF contient ${n} pages. Quelle page importer ?`, '1') || '1', 10));
    checkpoint();
    const targetW = 1500; // largeur initiale : 15 m, à corriger par la mise à l'échelle
    const scale = targetW / r.w;
    const center = { x: (V.w / 2 - V.ox) / V.scale, y: (V.h / 2 - V.oy) / V.scale };
    store.doc.background = { src: r.src, w: r.w, h: r.h, x: center.x - (r.w * scale) / 2, y: center.y - (r.h * scale) / 2, scale, rot: 0, opacity: 0.55, locked: false, visible: true, print: false, name: file.name };
    setSelection({ type: 'background', id: 'background' });
    emit('geometry');
    fitView(planExtents(true));
    setTool('calib');
    toast('Plan importé. Mise à l’échelle : cliquez 2 points dont vous connaissez la distance réelle.', 7000);
  } catch (err) { console.error(err); toast('Import impossible : ' + err.message, 6000); }
}
function calibClick(p) {
  const dr = ui.draft;
  if (dr.pts.length >= 2) return;
  dr.pts.push(G.clone(p));
  render();
  if (dr.pts.length === 2) showCalibBar();
}
const calibBar = $('#calibBar'), calibInput = $('#calibInput');
function showCalibBar() {
  calibBar.style.display = 'flex';
  calibInput.value = '';
  setTimeout(() => { calibInput.focus(); }, 50);
}
function hideCalibBar() { calibBar.style.display = 'none'; }
function cancelCalib() { hideCalibBar(); if (ui.draft?.kind === 'calib') ui.draft.pts = []; render(); toast('Mise à l’échelle annulée. Cliquez à nouveau 2 points.'); }
function commitCalib() {
  const dr = ui.draft, bg = store.doc.background;
  const L = parseLen(calibInput.value);
  if (!L) { calibInput.focus(); toast('Tapez la distance réelle, par exemple 4,50'); return; }
  hideCalibBar();
  if (!dr || dr.kind !== 'calib' || dr.pts.length < 2 || !bg) { if (dr) dr.pts = []; render(); return; }
  const measured = G.dist(dr.pts[0], dr.pts[1]);
  if (measured < 1) { dr.pts = []; render(); return; }
  const k = L / measured;
  checkpoint();
  const p0 = dr.pts[0];
  bg.scale *= k;
  bg.x = p0.x + (bg.x - p0.x) * k;
  bg.y = p0.y + (bg.y - p0.y) * k;
  bg.locked = true;
  emit('geometry');
  fitView(planExtents(true));
  setTool('wallExt');
  toast(`Échelle appliquée (${fmtLen(measured)} → ${fmtLen(L)} ${store.doc.settings.dimUnit}). Fond verrouillé : redessinez les murs par-dessus.`, 7000);
}
$('#calibOk').onclick = commitCalib;
$('#calibCancel').onclick = cancelCalib;
calibInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitCalib(); } if (e.key === 'Escape') cancelCalib(); e.stopPropagation(); });
setBackgroundLoadedCallback(() => render());
function cancelTool() {
  if (ui.draft && ((ui.draft.kind === 'wall' && ui.draft.last) || (ui.draft.kind === 'dim' && ui.draft.pts.length) || (ui.draft.kind === 'parcel' && ui.draft.pts.length) || (ui.draft.kind === 'section' && ui.draft.a) || (ui.draft.kind === 'calib' && ui.draft.pts.length))) {
    if (ui.draft.kind === 'parcel') ui.draft.pts = [];
    finishDraft(); return;
  }
  if (ui.tool !== 'select') setTool('select'); else setSelection(null);
}

function wallClick(p) {
  const dr = ui.draft;
  const sn = snapPoint(p, { from: dr.last });
  if (!dr.last) { dr.last = sn.p; render(); return; }
  if (G.dist(sn.p, dr.last) < 2) return;
  checkpoint();
  addWall(dr.last, sn.p, dr.type);
  dr.last = sn.p;
  afterWallsChanged();
  if (sn.kind === 'node' || sn.kind === 'wall') { /* jonction : on continue quand même */ }
}
function commitLength() {
  const dr = ui.draft;
  const L = parseLen(lenInput.value);
  lenInput.style.display = 'none'; lenInput.value = '';
  if (!dr || dr.kind !== 'wall' || !dr.last || !L || !ui.mouse) return;
  const m = ui.snap?.p || ui.mouse;
  let dir = G.norm(G.sub(m, dr.last));
  if (!isFinite(dir.x) || (dir.x === 0 && dir.y === 0)) dir = { x: 1, y: 0 };
  const b = G.add(dr.last, G.mul(dir, L));
  checkpoint();
  addWall(dr.last, b, dr.type);
  dr.last = b;
  afterWallsChanged();
}
function placeOpening(p) {
  const nw = nearestWall(p, 60);
  if (!nw) { toast('Cliquez sur un mur pour poser l’ouverture.'); return; }
  const T = OPENING_TYPES[ui.openingType];
  checkpoint();
  const o = { id: uid('o'), wallId: nw.w.id, type: ui.openingType, pos: nw.s, width: T.width, height: T.height, sill: T.sill, side: defaultSide(nw.w.id), hinge: 'start' };
  if (T.height > nw.w.height) o.height = nw.w.height - Math.max(0, o.sill) - 5;
  clampOpening(o, nw.g);
  store.doc.openings.push(o);
  setSelection({ type: 'opening', id: o.id });
  emit('geometry');
}
function placeFurniture(p) {
  const def = FURNITURE[ui.furnType];
  const m = ui.snap?.p || p;
  checkpoint();
  const f = { id: uid('f'), type: ui.furnType, x: m.x, y: m.y, rot: ui.draft.rot, w: def.w, d: def.d, h: def.h };
  store.doc.furniture.push(f);
  setSelection({ type: 'furniture', id: f.id });
  emit('geometry');
}
function dimClick(p) {
  const dr = ui.draft;
  const sn = snapPoint(p);
  if (dr.pts.length < 2) { dr.pts.push(sn.p); if (dr.pts.length === 2 && G.dist(dr.pts[0], dr.pts[1]) < 1) dr.pts.pop(); render(); return; }
  const dir = G.norm(G.sub(dr.pts[1], dr.pts[0]));
  const off = G.dot(G.sub(p, dr.pts[0]), G.perp(dir));
  checkpoint();
  const dm = { id: uid('d'), a: dr.pts[0], b: dr.pts[1], offset: off };
  store.doc.dims.push(dm);
  dr.pts = [];
  setSelection({ type: 'dim', id: dm.id });
  emit('geometry');
}
function parcelClick(p) {
  const dr = ui.draft;
  const sn = snapPoint(p, { from: dr.pts[dr.pts.length - 1] || null });
  if (dr.pts.length >= 3 && G.dist(sn.p, dr.pts[0]) < 12 / V.scale) { finishDraft(); return; }
  dr.pts.push(sn.p);
  render();
}
function sectionClick(p) {
  const dr = ui.draft;
  const sn = snapPoint(p, { from: dr.a });
  if (!dr.a) { dr.a = sn.p; render(); return; }
  if (G.dist(sn.p, dr.a) < 5) return;
  checkpoint();
  store.doc.section = { a: dr.a, b: sn.p, label: 'A', flip: false };
  setSelection({ type: 'section', id: 'section' });
  emit('geometry');
  setTool('select');
  toast('Ligne de coupe placée. Voir l’onglet « Coupe ».');
}

// ---------- Souris ----------
function selectDown(p, e) {
  const sel = store.selection, o = selected();
  const hs = 9 / V.scale;
  const cpPending = { moved: false };
  if (sel && o) {
    if (sel.type === 'wall') for (const end of ['a', 'b']) if (G.dist(p, o[end]) < hs) { ui.drag = { kind: 'node', nodes: wallsAtNode(store.doc.walls, o[end]), ...cpPending }; canvas.className = 'move'; return; }
    if (sel.type === 'dim') for (const end of ['a', 'b']) if (G.dist(p, o[end]) < hs) { ui.drag = { kind: 'dimEnd', dm: o, end, ...cpPending }; return; }
    if (sel.type === 'section') for (const end of ['a', 'b']) if (G.dist(p, o[end]) < hs) { ui.drag = { kind: 'secEnd', sec: o, end, ...cpPending }; return; }
    if (sel.type === 'parcel') for (let i = 0; i < o.pts.length; i++) if (G.dist(p, o.pts[i]) < hs) { ui.drag = { kind: 'parcelPt', i, ...cpPending }; return; }
    if (sel.type === 'roof') {
      const ang = (o.angle * Math.PI) / 180, c = { x: o.cx, y: o.cy };
      if (G.dist(p, G.add(c, G.rot({ x: o.length / 2, y: 0 }, ang))) < hs) { ui.drag = { kind: 'roofSize', r: o, axis: 'length', ...cpPending }; return; }
      if (G.dist(p, G.add(c, G.rot({ x: 0, y: o.width / 2 }, ang))) < hs) { ui.drag = { kind: 'roofSize', r: o, axis: 'width', ...cpPending }; return; }
    }
  }
  const h = hitTest(p);
  if (!h) { setSelection(null); ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: V.ox, oy: V.oy }; canvas.className = 'grab'; return; }
  if (!sel || sel.type !== h.type || sel.id !== h.id) setSelection(h);
  const obj = selected();
  const d = store.doc;
  switch (h.type) {
    case 'wall': { const ends = [...wallsAtNode(d.walls, obj.a).map((x) => ({ ...x, which: 'a' })), ...wallsAtNode(d.walls, obj.b).map((x) => ({ ...x, which: 'b' }))]; ui.drag = { kind: 'wall', w: obj, ends, orig: ends.map((x) => G.clone(x.w[x.end])), start: p, ...cpPending }; canvas.className = 'move'; break; }
    case 'furniture': ui.drag = { kind: 'furniture', f: obj, orig: { x: obj.x, y: obj.y }, start: p, ...cpPending }; canvas.className = 'move'; break;
    case 'opening': ui.drag = { kind: 'opening', o: obj, ...cpPending }; canvas.className = 'move'; break;
    case 'dim': ui.drag = { kind: 'dim', dm: obj, ...cpPending }; break;
    case 'section': ui.drag = { kind: 'section', sec: obj, orig: { a: G.clone(obj.a), b: G.clone(obj.b) }, start: p, ...cpPending }; break;
    case 'roof': ui.drag = { kind: 'roof', r: obj, orig: { cx: obj.cx, cy: obj.cy }, start: p, ...cpPending }; break;
    case 'parcel': ui.drag = { kind: 'parcelMove', orig: obj.pts.map(G.clone), start: p, ...cpPending }; break;
    case 'background': ui.drag = { kind: 'bg', bg: obj, orig: { x: obj.x, y: obj.y }, start: p, ...cpPending }; canvas.className = 'move'; break;
    default: ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: V.ox, oy: V.oy };
  }
}
function dragMove(p, e) {
  const dr = ui.drag, d = store.doc;
  if (dr.kind === 'pan') {
    if (ui.view === 'facades' || ui.view === 'coupe') { const s = ui.sub[ui.view]; s.px = dr.spx + (e.clientX - dr.sx); s.py = dr.spy + (e.clientY - dr.sy); }
    else { V.ox = dr.ox + (e.clientX - dr.sx); V.oy = dr.oy + (e.clientY - dr.sy); }
    render(); return;
  }
  if (dr.kind === 'rect') { dr.cur = snapPoint(p).p; render(); return; }
  const cp = () => { if (!dr.moved) { checkpoint(); dr.moved = true; } };
  const delta = dr.start ? { x: snapGrid(p.x - dr.start.x), y: snapGrid(p.y - dr.start.y) } : null;
  switch (dr.kind) {
    case 'node': { const sn = snapPoint(p, { exclude: dr.nodes.map((n) => n.w) }); cp(); for (const n of dr.nodes) n.w[n.end] = G.clone(sn.p); ui.snap = sn; emit('geometry'); break; }
    case 'wall': cp(); dr.ends.forEach((x, i) => { x.w[x.end] = G.add(dr.orig[i], delta); }); emit('geometry'); break;
    case 'furniture': cp(); dr.f.x = dr.orig.x + delta.x; dr.f.y = dr.orig.y + delta.y; emit('geometry'); break;
    case 'opening': { const nw = nearestWall(p, 80); if (!nw) break; cp(); if (nw.w.id !== dr.o.wallId) { dr.o.wallId = nw.w.id; dr.o.side = defaultSide(nw.w.id); } dr.o.pos = snapGrid(nw.s); clampOpening(dr.o, nw.g); emit('geometry'); break; }
    case 'dim': { cp(); const dir = G.norm(G.sub(dr.dm.b, dr.dm.a)); dr.dm.offset = G.dot(G.sub(p, dr.dm.a), G.perp(dir)); emit('geometry'); break; }
    case 'dimEnd': { const sn = snapPoint(p); cp(); dr.dm[dr.end] = sn.p; ui.snap = sn; emit('geometry'); break; }
    case 'secEnd': { const other = dr.end === 'a' ? dr.sec.b : dr.sec.a; const sn = snapPoint(p, { from: other }); cp(); dr.sec[dr.end] = sn.p; emit('geometry'); break; }
    case 'section': cp(); dr.sec.a = G.add(dr.orig.a, delta); dr.sec.b = G.add(dr.orig.b, delta); emit('geometry'); break;
    case 'roof': cp(); dr.r.cx = dr.orig.cx + delta.x; dr.r.cy = dr.orig.cy + delta.y; emit('geometry'); break;
    case 'roofSize': { cp(); const r = dr.r, ang = (r.angle * Math.PI) / 180; const l = G.rot(G.sub(p, { x: r.cx, y: r.cy }), -ang); if (dr.axis === 'length') r.length = Math.max(100, snapGrid(Math.abs(l.x) * 2)); else r.width = Math.max(100, snapGrid(Math.abs(l.y) * 2)); emit('geometry'); break; }
    case 'parcelPt': cp(); d.parcel.pts[dr.i] = { x: snapGrid(p.x), y: snapGrid(p.y) }; emit('geometry'); break;
    case 'parcelMove': cp(); d.parcel.pts = dr.orig.map((q) => G.add(q, delta)); emit('geometry'); break;
    case 'bg': cp(); dr.bg.x = dr.orig.x + (p.x - dr.start.x); dr.bg.y = dr.orig.y + (p.y - dr.start.y); emit('geometry'); break;
  }
}
function dragEnd(p) {
  const dr = ui.drag;
  ui.drag = null;
  canvas.className = ui.tool === 'select' ? '' : 'crosshair';
  if (!dr) return;
  if (dr.kind === 'rect') {
    const a = dr.start, b = dr.cur;
    if (Math.abs(b.x - a.x) > 20 && Math.abs(b.y - a.y) > 20) {
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const insideHouse = topo().footprints.some((f) => G.pointInPoly(c, f.outer));
      const type = insideHouse ? 'int' : 'ext';
      checkpoint();
      const P = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      for (let i = 0; i < 4; i++) addWall(P[i], P[(i + 1) % 4], type);
      afterWallsChanged();
      toast(insideHouse ? 'Cloisons créées.' : 'Pièce créée. Ajoutez des cloisons, portes et fenêtres.');
    }
    render(); return;
  }
  if ((dr.kind === 'node' || dr.kind === 'wall') && dr.moved) afterWallsChanged();
  if (dr.moved) updatePanel();
  render();
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  canvas.setPointerCapture(e.pointerId);
  lenInput.style.display = 'none';
  const p = toWorld(e); ui.mouse = p;
  const panDrag = () => { const s = ui.sub[ui.view] || {}; ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: V.ox, oy: V.oy, spx: s.px || 0, spy: s.py || 0 }; canvas.className = 'grab'; };
  if (e.button === 1 || e.button === 2 || ui.space || ui.view !== 'plan') { panDrag(); return; }
  if (e.detail === 2) return;
  switch (ui.tool) {
    case 'select': return selectDown(p, e);
    case 'wallExt': case 'wallInt': return wallClick(p);
    case 'rect': { const s = snapPoint(p).p; ui.drag = { kind: 'rect', start: s, cur: s }; return; }
    case 'opening': return placeOpening(p);
    case 'furniture': return placeFurniture(p);
    case 'dim': return dimClick(p);
    case 'parcel': return parcelClick(p);
    case 'section': return sectionClick(p);
    case 'calib': if (ui.draft?.pts.length >= 2) { calibInput.focus(); return; } return calibClick(p);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e); ui.mouse = p; ui.shift = e.shiftKey;
  if (ui.drag) { dragMove(p, e); return; }
  if (ui.view !== 'plan') { updateFooter(); return; }
  ui.snap = null; ui.hoverOpening = null; ui.hover = null;
  const dr = ui.draft;
  if (dr?.kind === 'wall') ui.snap = snapPoint(p, { from: dr.last });
  else if (dr?.kind === 'dim' || dr?.kind === 'rect') ui.snap = snapPoint(p);
  else if (dr?.kind === 'parcel') ui.snap = snapPoint(p, { from: dr.pts[dr.pts.length - 1] || null });
  else if (dr?.kind === 'section') ui.snap = snapPoint(p, { from: dr.a });
  else if (dr?.kind === 'calib') ui.snap = null;
  else if (dr?.kind === 'furn') ui.snap = { p: { x: snapGrid(p.x), y: snapGrid(p.y) }, kind: 'grid' };
  else if (ui.tool === 'rect') ui.snap = snapPoint(p);
  else if (ui.tool === 'opening') { const nw = nearestWall(p, 60); if (nw) ui.hoverOpening = { g: nw.g, s: snapGrid(nw.s), w: nw.w }; }
  else if (ui.tool === 'select') ui.hover = hitTest(p);
  render();
});
canvas.addEventListener('pointerup', (e) => dragEnd(toWorld(e)));
canvas.addEventListener('pointercancel', () => { ui.drag = null; render(); });
canvas.addEventListener('dblclick', (e) => {
  const p = toWorld(e);
  if (ui.draft && ui.tool !== 'select') { finishDraft(); return; }
  if (ui.tool === 'select') {
    const h = hitTest(p);
    if (h?.type === 'room') { setSelection(h); setTimeout(() => { const i = pbody.querySelector('[data-k="sel.name"]'); i?.focus(); i?.select(); }, 30); }
    if (h?.type === 'wall' || h?.type === 'opening' || h?.type === 'furniture') { setSelection(h); setTimeout(() => pbody.querySelector('input,select')?.focus(), 30); }
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(f, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Clavier ----------
window.addEventListener('keydown', (e) => {
  const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (e.target === lenInput) {
    if (e.key === 'Enter') { e.preventDefault(); commitLength(); }
    if (e.key === 'Escape') { lenInput.style.display = 'none'; lenInput.value = ''; render(); }
    return;
  }
  if (inField) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); afterUndo(); return; }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); afterUndo(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
  if (e.code === 'Space') { ui.space = true; e.preventDefault(); return; }
  if (ui.view === '3d') return;
  if (e.key === 'Escape') { cancelTool(); return; }
  if (e.key === 'Enter') { if (ui.draft) finishDraft(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (ui.draft?.kind === 'wall' && ui.draft.last && /^[0-9.,]$/.test(e.key)) {
    e.preventDefault();
    const q = S(ui.snap?.p || ui.mouse || { x: 0, y: 0 });
    lenInput.style.left = Math.min(V.w - 100, q.x + 16) + 'px'; lenInput.style.top = Math.min(V.h - 40, q.y + 16) + 'px';
    lenInput.style.display = 'block'; lenInput.value = e.key; lenInput.focus();
    return;
  }
  if (e.key.toLowerCase() === 'r' && !meta) {
    if (ui.draft?.kind === 'furn') { ui.draft.rot = (ui.draft.rot + 90) % 360; render(); return; }
    const o = selected();
    if (store.selection?.type === 'furniture' && o) { checkpoint(); o.rot = (o.rot + 90) % 360; emit('geometry'); return; }
    setTool('rect'); return;
  }
  if (store.selection?.type === 'furniture' && e.key.startsWith('Arrow')) {
    const o = selected(); if (!o) return; e.preventDefault();
    const step = e.shiftKey ? 10 : 1; checkpoint();
    if (e.key === 'ArrowLeft') o.x -= step; if (e.key === 'ArrowRight') o.x += step; if (e.key === 'ArrowUp') o.y -= step; if (e.key === 'ArrowDown') o.y += step;
    emit('geometry'); return;
  }
  const k = e.key.toLowerCase();
  if (k === 'v') setTool('select'); else if (k === 'm') setTool('wallExt'); else if (k === 'c') setTool('wallInt');
  else if (k === 'p') setTool('opening', 'porte'); else if (k === 'f') setTool('opening', 'fenetre'); else if (k === 'd') setTool('dim');
  else if (k === 'a') fitCurrent();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') ui.space = false; });
function afterUndo() { afterWallsChanged(); }

// ---------- Panneau de propriétés ----------
const row = (label, input) => `<div class="row"><label>${label}</label>${input}</div>`;
const num = (k, v, unit = '', step = 1, min = null) => `<div class="unit"><input type="number" data-k="${k}" value="${Math.round(v * 100) / 100}" step="${step}" ${min !== null ? `min="${min}"` : ''}><span>${unit}</span></div>`;
const sel = (k, v, opts) => `<select data-k="${k}">${Object.entries(opts).map(([a, b]) => `<option value="${a}" ${a === String(v) ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
const chk = (k, v) => `<input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`;
// Pastilles de couleur + sélecteur libre
const colorPick = (k, v, presets) => `<div class="swatches">${presets.map(([c, n]) => `<button class="sw${c.toLowerCase() === String(v).toLowerCase() ? ' on' : ''}" data-swatch="${c}" data-k="${k}" title="${n}" style="background:${c}"></button>`).join('')}<input type="color" data-k="${k}" value="${v}" title="Autre couleur"></div>`;
const JC = JOINERY_COLORS.map((x) => [x.c, x.n]);
const txt = (k, v, ph = '', list = '') => `<input type="text" data-k="${k}" value="${(v ?? '').replace(/"/g, '&quot;')}" placeholder="${ph}" ${list ? `list="${list}"` : ''}>`;

function updatePanel() {
  if (ui.ptab === 'lib') return renderLibrary();
  const s = store.selection, o = selected(), d = store.doc;
  let h = '';
  if (s && o) {
    const del = `<button class="btn small danger" data-act="delete">Supprimer</button>`;
    if (s.type === 'wall') {
      const Gm = wallGeoms().get(o.id);
      h += `<div class="sec"><h3>Mur <span class="tag">${o.type === 'ext' ? 'extérieur' : 'cloison'}</span></h3>
        ${row('Type', sel('sel.type', o.type, { ext: 'Mur extérieur', int: 'Cloison' }))}
        ${row('Longueur (axe)', num('wall.length', Gm ? Gm.L : 0, 'cm', 1, 1))}
        ${row('Épaisseur', num('sel.thickness', o.thickness, 'cm', 1, 3))}
        ${row('Hauteur', num('sel.height', o.height, 'cm', 1, 50))}
        <div class="actions">${del}</div></div>`;
      if (o.type === 'ext') {
        const F = wallFinish(o);
        h += `<div class="sec"><h3>Parement extérieur</h3>
          ${row('Revêtement', sel('sel.finish', o.finish || '', { '': `Par défaut (${FINISHES[d.settings.facadeFinish]?.label || 'Enduit'})`, ...Object.fromEntries(Object.entries(FINISHES).map(([k2, v2]) => [k2, v2.label])) }))}
          ${o.finish ? row('Teinte', colorPick('sel.finishColor', F.color, F.def.colors)) : ''}
          <div class="actions"><button class="btn small" data-act="finishAll">Appliquer à tous les murs extérieurs</button></div>
          <p class="hint">Visible en 3D et sur les façades. Exemple : pierre en soubassement du rez-de-chaussée, bardage à l’étage.</p></div>`;
      }
    } else if (s.type === 'opening') {
      const T = OPENING_TYPES[o.type];
      h += `<div class="sec"><h3>${T.label}</h3>
        ${row('Type', sel('opening.type', o.type, Object.fromEntries(Object.entries(OPENING_TYPES).map(([k, v]) => [k, v.label]))))}
        ${row('Largeur', num('sel.width', o.width, 'cm', 1, 20))}
        ${row('Hauteur', num('sel.height', o.height, 'cm', 1, 20))}
        ${T.kind === 'window' ? row('Allège (hauteur)', num('sel.sill', o.sill, 'cm', 1, 0)) : ''}
        ${row('Position sur le mur', num('sel.pos', o.pos, 'cm', 1, 0))}
        ${T.kind === 'door' || T.kind === 'french' || (T.kind === 'window' && joinery(o).leaves === 1) ? `<div class="actions">${T.kind !== 'window' ? `<button class="btn small" data-act="flipSide">Ouvrir de l’autre côté</button>` : ''}${T.kind === 'door' || joinery(o).leaves === 1 ? `<button class="btn small" data-act="flipHinge">Changer les charnières</button>` : ''}</div>` : ''}
        <div class="actions">${del}</div></div>`;
      const J = joinery(o);
      h += `<div class="sec"><h3>Menuiserie</h3>
        ${row('Matériau', sel('sel.material', J.material, JOINERY_MATERIALS))}
        ${row('Couleur', colorPick('sel.color', J.color, JC))}
        ${J.glazed ? `
          ${row(J.kind === 'slider' ? 'Vantaux' : 'Ouvrants', sel('sel.leaves', J.leaves, J.kind === 'slider' ? { 2: '2 vantaux', 3: '3 vantaux', 4: '4 vantaux' } : { 0: 'Fixe (non ouvrant)', 1: '1 vantail', 2: '2 vantaux', 3: '3 vantaux', 4: '4 vantaux' }))}
          ${row('Imposte fixe en haut', num('sel.transom', J.transom, 'cm', 5, 0))}
          ${J.kind !== 'window' || o.height >= 150 ? row('Partie fixe en bas', num('sel.lower', J.lower, 'cm', 5, 0)) : ''}
          ${row('Petits bois verticaux (par vantail)', num('sel.barsX', J.barsX, '', 1, 0))}
          ${row('Petits bois horizontaux (par vantail)', num('sel.barsY', J.barsY, '', 1, 0))}` : ''}
        <div class="actions"><button class="btn small" data-act="joineryColorAll">Cette couleur partout</button>${J.glazed ? `<button class="btn small" data-act="joineryModelAll">Ce modèle pour toutes les « ${T.short} »</button>` : ''}</div>
        <p class="hint">Imposte : 0 = aucune. Petits bois : 0 = vitrage d’un seul tenant.</p></div>`;
    } else if (s.type === 'room') {
      const rr = resolvedRooms().find((x) => x.room.id === o.id);
      h += `<div class="sec"><h3>Pièce</h3>
        ${row('Nom', txt('sel.name', o.name, 'Nom de la pièce', 'roomNames'))}<datalist id="roomNames">${ROOM_NAMES.map((n) => `<option value="${n}">`).join('')}</datalist>
        ${row('Sol', sel('sel.floor', o.floor, FLOORS))}
        <div class="stat"><span>Surface</span><b>${rr ? (rr.area / 1e4).toFixed(2).replace('.', ',') : '—'} m²</b></div>
        <p class="hint">La surface est calculée à l’intérieur des murs (surface de plancher). Le nom « Garage » ou « Terrasse » exclut la pièce de la surface habitable.</p></div>`;
    } else if (s.type === 'furniture') {
      const def = FURNITURE[o.type];
      h += `<div class="sec"><h3>${def.label}</h3>
        ${row('Largeur', num('sel.w', o.w, 'cm', 1, 5))}${row('Profondeur', num('sel.d', o.d, 'cm', 1, 5))}${row('Hauteur', num('sel.h', o.h, 'cm', 1, 1))}
        ${row('Rotation', num('sel.rot', o.rot, '°', 15))}
        <div class="actions"><button class="btn small" data-act="rotate">Pivoter 90°</button><button class="btn small" data-act="duplicate">Dupliquer</button>${del}</div></div>`;
    } else if (s.type === 'dim') {
      h += `<div class="sec"><h3>Cote</h3><div class="stat"><span>Longueur</span><b>${fmtLen(G.dist(o.a, o.b))} ${d.settings.dimUnit}</b></div>${row('Décalage', num('sel.offset', o.offset, 'cm', 5))}<div class="actions">${del}</div></div>`;
    } else if (s.type === 'roof') {
      const geo = roofGeometry(o);
      h += `<div class="sec"><h3>Toiture</h3>
        ${row('Type', sel('sel.type', o.type, ROOF_TYPES))}
        ${o.type !== 'plat' ? row('Pente', num('sel.pitch', o.pitch, '°', 1, 5)) : ''}
        ${row('Débord de toit', num('sel.overhang', o.overhang, 'cm', 5, 0))}
        ${row('Longueur (murs)', num('sel.length', o.length, 'cm', 10, 100))}${row('Largeur (murs)', num('sel.width', o.width, 'cm', 10, 100))}
        ${row('Orientation', num('sel.angle', o.angle, '°', 5))}
        ${row('Hauteur égout', num('sel.eave', o.eave, 'cm', 5, 100))}
        ${row('Couverture', sel('sel.material', o.material, { tuile: 'Tuiles', ardoise: 'Ardoises', zinc: 'Zinc / bac acier' }))}
        <div class="stat"><span>Hauteur au faîtage</span><b>${(geo.ridgeZ / 100).toFixed(2).replace('.', ',')} m</b></div>
        <div class="actions"><button class="btn small" data-act="roofFit">Recaler sur les murs</button>${del}</div></div>`;
    } else if (s.type === 'section') {
      h += `<div class="sec"><h3>Ligne de coupe</h3>${row('Repère', txt('sel.label', o.label || 'A'))}
        <div class="actions"><button class="btn small" data-act="flipSection">Inverser le sens de vue</button>${del}</div>
        <p class="hint">Les flèches indiquent le sens d’observation. La coupe est visible dans l’onglet « Coupe ».</p></div>`;
    } else if (s.type === 'background') {
      h += `<div class="sec"><h3>Fond de plan <span class="tag">${(o.name || '').slice(0, 24)}</span></h3>
        <p class="hint">Glissez le fond pour le positionner. Mettez-le à l’échelle (2 points + distance réelle), puis redessinez les murs par-dessus. Réglages ci-dessous.</p></div>`;
    } else if (s.type === 'parcel') {
      h += `<div class="sec"><h3>Parcelle</h3><div class="stat"><span>Surface</span><b>${o.pts.length > 2 ? (G.area(o.pts) / 1e4).toFixed(0) : '—'} m²</b></div>
        ${row('Référence cadastrale', txt('project.parcelRef', d.project.parcelRef, 'Section / n°'))}
        <p class="hint">Glissez les poignées pour ajuster les coins du terrain.</p><div class="actions">${del}</div></div>`;
    }
  }
  if (d.background) {
    const b = d.background;
    h += `<div class="sec"><h3>Fond de plan importé</h3>
      ${row('Visible', chk('bg.visible', b.visible !== false))}
      ${row('Verrouillé', chk('bg.locked', b.locked))}
      ${row('Opacité', `<input type="range" min="0.1" max="1" step="0.05" data-k="bg.opacity" value="${b.opacity ?? 0.5}">`)}
      ${row('Rotation', num('bg.rot', b.rot || 0, '°', 0.5))}
      ${row('Inclure dans le PDF', chk('bg.print', b.print))}
      <div class="actions"><button class="btn small primary" data-act="calib">Mettre à l’échelle</button><button class="btn small" data-act="selectBg">Déplacer</button><button class="btn small danger" data-act="deleteBg">Retirer le fond</button></div></div>`;
  }
  {
    const lv = activeLevel(), L = levelInfo()[d.activeLevel], multi = d.levels.length > 1;
    h += `<div class="sec"><h3>Niveau <span class="tag">${d.activeLevel + 1} / ${d.levels.length}</span></h3>
      ${row('Nom', txt('level.name', lv.name, 'Nom du niveau'))}
      ${row('Hauteur sous plafond', num('level.height', lv.height, 'cm', 5, 100))}
      ${multi ? row('Épaisseur des planchers', num('settings.slabThickness', d.settings.slabThickness, 'cm', 1, 5)) : ''}
      ${multi ? `<div class="stat"><span>Sol fini de ce niveau</span><b>${L.z0 >= 0 ? '+' : ''}${(L.z0 / 100).toFixed(2).replace('.', ',')} m</b></div>` : ''}
      <div class="actions"><button class="btn small primary" data-act="levelAbove">＋ Étage au-dessus</button><button class="btn small" data-act="levelBelow">＋ Niveau en dessous</button></div>
      <div class="actions"><button class="btn small" data-act="levelImport">Importer un niveau (fichier)…</button></div>
      ${multi ? `<div class="actions"><button class="btn small" data-act="levelUp" ${d.activeLevel === d.levels.length - 1 ? 'disabled' : ''}>Monter</button><button class="btn small" data-act="levelDown" ${d.activeLevel === 0 ? 'disabled' : ''}>Descendre</button><button class="btn small danger" data-act="levelDelete">Supprimer ce niveau</button></div>
      ${row('Niveau voisin en filigrane', chk('settings.showGhost', d.settings.showGhost !== false))}
      ${row('Décaler ce niveau', `<div class="unit"><input type="number" id="lvDx" value="0" step="1" title="vers la droite (cm)"><input type="number" id="lvDy" value="0" step="1" title="vers le bas (cm)"><span>cm</span></div>`)}
      <div class="actions"><button class="btn small" data-act="levelShift">Appliquer le décalage</button></div>
      <p class="hint">Le niveau voisin apparaît en bleu clair sous le plan pour aligner les étages. Une pièce nommée « Trémie » ou « Vide sur séjour » perce le plancher (escalier) et ne compte pas dans la surface.</p>` : '<p class="hint">« Étage au-dessus » crée un nouveau niveau avec les mêmes murs extérieurs.</p>'}</div>`;
  }
  const st = stats();
  h += `<div class="sec"><h3>Projet</h3>
    ${row('Maître d’ouvrage', txt('project.owner', d.project.owner, 'Nom Prénom'))}
    ${row('Adresse', txt('project.address', d.project.address, 'Adresse du terrain'))}
    ${row('Parcelle', txt('project.parcelRef', d.project.parcelRef, 'Section AB n° 12'))}
    ${row('Date', txt('project.date', d.project.date))}</div>`;
  h += `<div class="sec"><h3>Surfaces${d.levels.length > 1 ? ' — ' + activeLevel().name : ''}</h3>
    ${st.rooms.map((r) => `<div class="stat"><span>${r.room.name}</span><b>${(r.area / 1e4).toFixed(2).replace('.', ',')} m²</b></div>`).join('')}
    <div class="stat"><span><b>Surface habitable${d.levels.length > 1 ? ' du niveau' : ''}</b></span><b>${st.habitable.toFixed(2).replace('.', ',')} m²</b></div>
    ${d.levels.length > 1 ? `<div class="stat"><span><b>Surface habitable totale</b></span><b>${st.habitableTotal.toFixed(2).replace('.', ',')} m²</b></div>` : ''}
    <div class="stat"><span><b>Emprise au sol</b></span><b>${st.emprise.toFixed(2).replace('.', ',')} m²</b></div></div>`;
  h += `<div class="sec"><h3>Réglages</h3>
    ${row('Épaisseur murs ext.', num('settings.extThickness', d.settings.extThickness, 'cm', 1, 5))}
    ${row('Épaisseur cloisons', num('settings.intThickness', d.settings.intThickness, 'cm', 1, 3))}
    ${row('Sol fini / terrain', num('settings.floorAboveGround', d.settings.floorAboveGround, 'cm', 5, 0))}
    ${row('Unité des cotes', sel('settings.dimUnit', d.settings.dimUnit, { m: 'mètres (3,50)', cm: 'centimètres (350)' }))}
    ${row('Grille d’accrochage', sel('settings.gridSnap', d.settings.gridSnap, { 1: '1 cm', 5: '5 cm', 10: '10 cm', 25: '25 cm', 50: '50 cm' }))}
    ${row('Cotes automatiques', chk('settings.autoDims', d.settings.autoDims))}
    ${row('Afficher les meubles', chk('settings.showFurniture', d.settings.showFurniture))}
    ${row('Afficher la toiture', chk('settings.showRoof', d.settings.showRoof))}</div>`;
  h += `<div class="sec"><h3>Façades par défaut</h3>
    ${row('Parement des murs', sel('settings.facadeFinish', d.settings.facadeFinish, Object.fromEntries(Object.entries(FINISHES).map(([k2, v2]) => [k2, v2.label]))))}
    ${row('Teinte', colorPick('settings.facadeColor', d.settings.facadeColor, (FINISHES[d.settings.facadeFinish] || FINISHES.enduit).colors))}
    ${row('Menuiseries', sel('settings.joineryMaterial', d.settings.joineryMaterial, JOINERY_MATERIALS))}
    ${row('Couleur menuiseries', colorPick('settings.joineryColor', d.settings.joineryColor, JC))}
    <p class="hint">S’applique aux murs et menuiseries qui n’ont pas de réglage propre.</p></div>`;
  pbody.innerHTML = h;
}

function renderLibrary() {
  let h = '<p class="hint">Cliquez sur un meuble puis sur le plan pour le poser. <b>R</b> pour pivoter.</p><div class="lib">';
  for (const cat of FURNITURE_CATS) {
    h += `<h4>${cat}</h4>`;
    for (const [k, f] of Object.entries(FURNITURE)) if (f.cat === cat) h += `<button data-furn="${k}" class="${ui.furnType === k && ui.tool === 'furniture' ? 'active' : ''}"><canvas width="144" height="96" data-thumb="${k}"></canvas>${f.label}<small style="color:#888">${f.w}×${f.d}</small></button>`;
  }
  pbody.innerHTML = h + '</div>';
  for (const cv of pbody.querySelectorAll('canvas[data-thumb]')) {
    const f = FURNITURE[cv.dataset.thumb], c2 = cv.getContext('2d');
    const sc = Math.min(120 / f.w, 80 / f.d);
    c2.translate(72, 48); c2.scale(sc, sc); c2.beginPath(); f.draw(c2, f.w, f.d);
    c2.fillStyle = '#fafafa'; c2.fill(); c2.lineWidth = 1.2 / sc; c2.strokeStyle = '#444'; c2.stroke();
  }
}

function resolve(path) {
  const [root, key] = path.split('.');
  if (root === 'sel') return [selected(), key];
  if (root === 'settings') return [store.doc.settings, key];
  if (root === 'project') return [store.doc.project, key];
  if (root === 'bg') return [store.doc.background, key];
  if (root === 'level') return [activeLevel(), key];
  return [null, key];
}
pbody.addEventListener('change', (e) => {
  const el = e.target, k = el.dataset.k;
  if (!k) return;
  const val = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? parseFloat(el.value) : el.value;
  if (el.type === 'number' && isNaN(val)) { updatePanel(); return; }
  const d = store.doc;
  checkpoint();
  if (k === 'wall.length') {
    const w = selected(); const Gm = wallGeoms().get(w.id);
    const nb = G.add(w.a, G.mul(Gm.d, Math.max(1, val)));
    for (const n of wallsAtNode(d.walls, w.b)) n.w[n.end] = G.clone(nb);
    afterWallsChanged(); return;
  }
  if (k === 'opening.type') {
    const o = selected(), T = OPENING_TYPES[val];
    Object.assign(o, { type: val, width: T.width, height: T.height, sill: T.sill }); delete o.leaves;
    clampOpening(o, wallGeoms().get(o.wallId)); emit('geometry'); return;
  }
  const [obj, key] = resolve(k);
  if (!obj) return;
  const tops = levelTops();
  obj[key] = el.tagName === 'SELECT' && !isNaN(parseFloat(val)) && !['type', 'floor', 'dimUnit', 'material', 'finish', 'facadeFinish', 'joineryMaterial'].includes(key) ? parseFloat(val) : val;
  if (k === 'sel.finish') { if (val) obj.finishColor = FINISHES[val].colors[0][0]; else { delete obj.finish; delete obj.finishColor; } }
  if (k === 'settings.facadeFinish') d.settings.facadeColor = FINISHES[val].colors[0][0];
  if (k === 'sel.leaves' && store.selection?.type === 'opening' && obj.barsX == null) { /* rien */ }
  if (k === 'level.height') { for (const w of d.walls) w.height = val; d.settings.wallHeight = d.levels[0].height; }
  if (k === 'level.height' || k === 'settings.slabThickness') followRoofs(tops);
  if (k === 'settings.extThickness') for (const l of d.levels) for (const w of l.walls) if (w.type === 'ext') w.thickness = val;
  if (k === 'settings.intThickness') for (const l of d.levels) for (const w of l.walls) if (w.type === 'int') w.thickness = val;
  if (k === 'sel.type' && store.selection.type === 'wall') obj.thickness = val === 'ext' ? d.settings.extThickness : d.settings.intThickness;
  if (k.startsWith('sel.') && store.selection?.type === 'opening') clampOpening(obj, wallGeoms().get(obj.wallId));
  if ((k.startsWith('sel.') && store.selection?.type === 'wall') || k === 'settings.extThickness' || k === 'settings.intThickness') afterWallsChanged(); else emit('geometry');
});
pbody.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-swatch]');
  if (sw) { const [obj, key] = resolve(sw.dataset.k); if (!obj) return; checkpoint(); obj[key] = sw.dataset.swatch; emit('geometry'); return; }
  const fb = e.target.closest('[data-furn]');
  if (fb) { setTool('furniture', fb.dataset.furn); renderLibrary(); toast(`${FURNITURE[fb.dataset.furn].label} : cliquez sur le plan pour le poser.`); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const o = selected(), d = store.doc;
  if (act === 'delete') return deleteSelection();
  if (act === 'calib') return setTool('calib');
  if (act === 'selectBg') { if (d.background) { d.background.locked = false; setSelection({ type: 'background', id: 'background' }); } return; }
  if (act === 'levelAbove') return addLevel(true);
  if (act === 'levelBelow') return addLevel(false);
  if (act === 'levelDelete') return deleteLevel();
  if (act === 'levelUp') return moveLevel(1);
  if (act === 'levelDown') return moveLevel(-1);
  if (act === 'levelImport') { $('#levelInput').click(); return; }
  if (act === 'levelShift') return shiftLevel(parseFloat($('#lvDx').value) || 0, parseFloat($('#lvDy').value) || 0);
  if (act === 'finishAll' && o) {
    checkpoint();
    for (const l of d.levels) for (const w of l.walls) if (w.type === 'ext') { if (o.finish) { w.finish = o.finish; w.finishColor = o.finishColor; } else { delete w.finish; delete w.finishColor; } }
    emit('geometry'); toast('Parement appliqué à tous les murs extérieurs (tous les niveaux).'); return;
  }
  if (act === 'joineryColorAll' && o) {
    checkpoint();
    const J = joinery(o);
    for (const l of d.levels) for (const op of l.openings) if (joinery(op).kind !== 'door' || op.type === 'entree') { op.color = J.color; op.material = J.material; }
    d.settings.joineryColor = J.color; d.settings.joineryMaterial = J.material;
    emit('geometry'); toast('Couleur et matériau appliqués à toutes les fenêtres, baies et portes extérieures.'); return;
  }
  if (act === 'joineryModelAll' && o) {
    checkpoint();
    const J = joinery(o); let n = 0;
    for (const l of d.levels) for (const op of l.openings) if (op.type === o.type) { Object.assign(op, { leaves: J.leaves, transom: J.transom, lower: J.lower, barsX: J.barsX, barsY: J.barsY, material: J.material, color: J.color }); n++; }
    emit('geometry'); toast(`Modèle appliqué à ${n} ouverture(s) « ${OPENING_TYPES[o.type].short} ».`); return;
  }
  if (act === 'deleteBg') { checkpoint(); d.background = null; if (store.selection?.type === 'background') store.selection = null; emit('geometry'); return; }
  checkpoint();
  if (act === 'rotate') o.rot = (o.rot + 90) % 360;
  if (act === 'duplicate') { const f = { ...o, id: uid('f'), x: o.x + 40, y: o.y + 40 }; d.furniture.push(f); store.selection = { type: 'furniture', id: f.id }; }
  if (act === 'flipSide') o.side = -(o.side || 1);
  if (act === 'flipHinge') o.hinge = o.hinge === 'end' ? 'start' : 'end';
  if (act === 'flipSection') o.flip = !o.flip;
  if (act === 'roofFit') { const T = levelData(store.doc.levels[roofLevelIndex(o)]).topo; if (T.footprints.length) { const box = G.orientedBox(T.footprints.sort((a, b) => G.area(b.outer) - G.area(a.outer))[0].outer); Object.assign(o, { cx: box.cx, cy: box.cy, length: Math.round(box.w), width: Math.round(box.h), angle: Math.round(box.angle * 10) / 10 }); } }
  emit('geometry');
});
$$('#panel .ptabs button').forEach((b) => b.addEventListener('click', () => { ui.ptab = b.dataset.ptab; $$('#panel .ptabs button').forEach((x) => x.classList.toggle('active', x === b)); updatePanel(); }));

// ---------- Vues ----------
function setView(v) {
  if (ui.view === v) return;
  if (v !== 'plan' && ui.tool !== 'select') setTool('select');
  ui.view = v;
  document.body.dataset.view = v;
  $$('#viewTabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  const is3d = v === '3d';
  $('#view3d').style.display = is3d ? 'block' : 'none';
  canvas.style.display = is3d ? 'none' : 'block';
  $('#planTb').style.display = is3d ? 'none' : 'flex';
  $('#tb3d').style.display = is3d ? 'flex' : 'none';
  $('#tbSection').style.display = v === 'coupe' && store.doc.section ? 'flex' : 'none';
  updateLevelBar();
  if (has3D) setActive(is3d);
  if (v === 'masse') fitView(masseExtents() || planExtents(true), 40);
  if (v === 'plan') fitView(planExtents(true) || { minX: -600, minY: -500, maxX: 600, maxY: 500 });
  render();
}
$$('#viewTabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('#tools .tool').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  if (t === 'roof') return addRoofAuto();
  if (t === 'importBg') { $('#bgInput').click(); return; }
  if (t === 'library') { ui.ptab = 'lib'; $$('#panel .ptabs button').forEach((x) => x.classList.toggle('active', x.dataset.ptab === 'lib')); updatePanel(); return; }
  setTool(t, b.dataset.arg || null);
}));
$('#btnFit').onclick = fitCurrent;
$('#btnZoomIn').onclick = () => zoomAt(1.25, V.w / 2, V.h / 2);
$('#btnZoomOut').onclick = () => zoomAt(0.8, V.w / 2, V.h / 2);
$('#btnUndo').onclick = () => { undo(); afterUndo(); };
$('#btnRedo').onclick = () => { redo(); afterUndo(); };
$('#btnHelp').onclick = () => $('#help').classList.add('show');
$('#helpClose').onclick = () => $('#help').classList.remove('show');
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').classList.remove('show'); });
$('#btnFlipSection').onclick = () => { if (!store.doc.section) return; checkpoint(); store.doc.section.flip = !store.doc.section.flip; emit('geometry'); };
$('#btnWalk').onclick = () => { startWalk(); $('#walkHint').style.display = 'block'; };
$('#view3d').addEventListener('walkend', () => { $('#walkHint').style.display = 'none'; });
$('#btnRoof3d').onclick = () => toggleRoof();
$('#btnCut').onclick = () => { if (!has3D) return; const on = toggleCutaway(); $('#btnCut').textContent = on ? 'Niveaux : jusqu’au niveau affiché' : 'Niveaux : tous'; if (on && store.doc.levels.length < 2) toast('Vue ouverte : toiture et plafond masqués.'); };
$('#levelBar').addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (!b) return; if (b.dataset.lv === 'add') addLevel(true); else setLevel(parseInt(b.dataset.lv, 10)); });
$('#levelInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const src = JSON.parse(await f.text()); if (!Array.isArray(src.walls) && !Array.isArray(src.levels)) throw new Error(); importLevels(src); }
  catch (err) { console.error(err); toast('Fichier illisible : ce n’est pas un projet MymiHouseBoucletteBuilder.'); }
  e.target.value = '';
});
$('#btnSnap').onclick = () => { const a = document.createElement('a'); a.download = `${store.doc.project.name || 'vue3d'}.png`; a.href = snapshot(); a.click(); };
$('#projName').addEventListener('change', (e) => { store.doc.project.name = e.target.value; emit('geometry'); });

// ---------- Fichiers ----------
function saveFile() {
  const blob = new Blob([JSON.stringify(store.doc, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `${store.doc.project.name || 'projet'}.archiplan.json`;
  a.href = URL.createObjectURL(blob); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Projet enregistré dans vos Téléchargements.');
}
$('#btnSave').onclick = saveFile;
$('#bgInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { if (ui.view !== 'plan') setView('plan'); importBg(f); } e.target.value = ''; });
$('#btnOpen').onclick = () => $('#fileInput').click();
$('#fileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.walls) && !Array.isArray(d.levels)) throw new Error(); loadDoc(d); afterLoad(); toast(`« ${store.doc.project.name} » ouvert.`); }
  catch { toast('Fichier illisible : ce n’est pas un projet MymiHouseBoucletteBuilder.'); }
  e.target.value = '';
});
$('#btnNew').onclick = () => { if (anyWalls() && !confirm('Créer un nouveau projet ? Le projet actuel reste dans vos fichiers si vous l’avez enregistré.')) return; loadDoc(newProject()); afterLoad(); setTool('wallExt'); };
$('#btnExample').onclick = () => { if (anyWalls() && !confirm('Remplacer le projet actuel par la maison d’exemple ?')) return; loadDoc(buildExample()); afterLoad(); };
$('#wExample').onclick = () => { $('#welcome').classList.remove('show'); loadDoc(buildExample()); afterLoad(); };
$('#wEmpty').onclick = () => { $('#welcome').classList.remove('show'); setTool('wallExt'); };
function afterLoad() { syncAllRooms(); if (has3D) resetFrame(); $('#projName').value = store.doc.project.name; setView('plan'); fitView(planExtents(true) || { minX: -600, minY: -500, maxX: 600, maxY: 500 }); render(); updatePanel(); }

$('#btnPDF').onclick = async () => {
  if (!anyWalls()) { toast('Dessinez d’abord des murs.'); return; }
  const btn = $('#btnPDF'); btn.disabled = true; btn.textContent = 'Export…';
  try {
    const snap = has3D ? offscreenSnapshot(1800, 1200) : null;
    await exportPDF({ snapshot: snap, onProgress: (i, n) => { btn.textContent = `Page ${i}/${n}…`; } });
    toast('Dossier PDF enregistré dans vos Téléchargements.');
  } catch (err) { console.error(err); toast('Export impossible : ' + err.message, 5000); }
  btn.disabled = false; btn.textContent = 'Exporter PDF';
};

// ---------- Démarrage ----------
on((kind) => {
  if (kind === 'geometry') { if (has3D) markDirty(); $('#tbSection').style.display = ui.view === 'coupe' && store.doc.section ? 'flex' : 'none'; }
  updateLevelBar();
  if (!ui.drag) updatePanel();   // pendant un glissement, le panneau est mis à jour à la fin
  render();
});
let has3D = true;
try { init3D($('#view3d')); } catch (err) { has3D = false; console.warn('3D indisponible :', err.message); $('#view3d').innerHTML = '<div class="stage-msg" style="display:flex">La vue 3D n’est pas disponible dans ce navigateur (WebGL désactivé). Le plan, la coupe, les façades et le PDF fonctionnent normalement.</div>'; }
new ResizeObserver(resizeCanvas).observe(stage);
resizeCanvas();
const params = new URLSearchParams(location.search);
const saved = loadAutosave();
if (params.get('load')) { $('#welcome').classList.remove('show'); fetch(params.get('load')).then((r) => r.json()).then((d) => { loadDoc(d); afterLoad(); if (params.get('level')) setLevel(parseInt(params.get('level'), 10)); for (const act of (params.get('click') || '').split(',').filter(Boolean)) pbody.querySelector(`[data-act="${act}"]`)?.click(); if (params.get('view')) setView(params.get('view')); showPageParam(); }).catch(() => toast('Projet introuvable : ' + params.get('load'))); }
else if (params.has('example')) { loadDoc(buildExample()); afterLoad(); }
else if (saved && (saved.walls?.length || saved.furniture?.length || saved.levels?.some((l) => l.walls?.length || l.furniture?.length))) { loadDoc(saved); afterLoad(); toast('Projet précédent restauré.'); }
else { $('#welcome').classList.add('show'); updatePanel(); }
if (params.get('level')) setLevel(parseInt(params.get('level'), 10));
if (params.has('cut')) $('#btnCut').click();
if (params.has('assist')) setTimeout(() => assistant.open(true), 0);
if (params.get('view')) setView(params.get('view'));
if (params.get('bg')) { $('#welcome').classList.remove('show'); fetch(params.get('bg')).then((r) => r.blob()).then((b) => importBg(new File([b], params.get('bg').split('/').pop(), { type: b.type }))); }
// ?page=plan|masse|coupe|facades : affiche une page du dossier (aperçu ou impression A3 via ?print)
function showPageParam() {
  if (!params.get('page')) return;
  const c = renderPage(params.get('page'));
  if (!c) return;
  if (params.has('print')) {
    const st = document.createElement('style');
    st.textContent = '@page{size:420mm 297mm;margin:0} html,body{margin:0;overflow:visible;height:auto;background:#fff} #app,.modal,#toast{display:none!important}';
    document.head.appendChild(st);
    c.style.cssText = 'width:420mm;height:297mm;display:block';
    document.body.appendChild(c);
    return;
  }
  const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:#888;z-index:50;overflow:auto';
  c.style.cssText = 'width:100%;display:block'; ov.appendChild(c); document.body.appendChild(ov);
}
if (!params.get('load')) showPageParam();
const assistant = initAssistant({ stage, toggleBtn: $('#btnAssist'), undo: () => { if (undo()) afterUndo(); }, setLevel, dropCheckpoint });
// Mode sombre / clair (mémorisé dans ce navigateur)
function applyTheme(t) { document.documentElement.dataset.theme = t; $('#btnTheme').textContent = t === 'dark' ? '☀️' : '🌙'; $('#btnTheme').title = t === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'; }
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
$('#btnTheme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); try { localStorage.setItem('mymi.theme', t); } catch (e) { /* stockage indisponible */ } };
updateLevelBar();
window.addEventListener('error', (e) => toast('Erreur : ' + e.message, 6000));
$('#projName').value = store.doc.project.name;
