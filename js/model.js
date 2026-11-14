// Modèle de données, historique (annuler/rétablir), sauvegarde auto et données dérivées
import { buildTopology } from './topology.js';
import { computeWallGeoms } from './walls.js';
import { pointInPoly, interiorPoint, area, add, mul } from './geom.js';

export const DEFAULT_SETTINGS = {
  wallHeight: 250, extThickness: 30, intThickness: 10, slabThickness: 20, floorAboveGround: 20,
  dimUnit: 'm', autoDims: true, showFurniture: true, showRoof: true, showGhost: true, gridSnap: 5,
  facadeFinish: 'enduit', facadeColor: '#efe9dc', joineryMaterial: 'pvc', joineryColor: '#f4f4f2',
};

export const ROOM_NAMES = ['Séjour', 'Salon', 'Cuisine', 'Séjour / Cuisine', 'Chambre 1', 'Chambre 2', 'Chambre 3', 'Suite parentale', 'Salle de bains', "Salle d'eau", 'WC', 'Entrée', 'Dégagement', 'Bureau', 'Cellier', 'Buanderie', 'Garage', 'Dressing', 'Terrasse'];
export const FLOORS = { parquet: 'Parquet', carrelage: 'Carrelage', beton: 'Béton', moquette: 'Moquette' };

export function today() { return new Date().toLocaleDateString('fr-FR'); }

export function newProject() {
  return bindDoc({
    version: 1,
    project: { name: 'Mon projet', address: '', owner: '', parcelRef: '', date: today(), architect: '' },
    settings: { ...DEFAULT_SETTINGS },
    levels: [newLevel('L1', 'Rez-de-chaussée', DEFAULT_SETTINGS.wallHeight)], activeLevel: 0,
    roofs: [], parcel: null, section: null,
    nextId: 1,
  });
}

// ---------- Niveaux ----------
// Chaque niveau porte ses murs, ouvertures, pièces, meubles, cotes et son fond de plan.
// doc.walls, doc.openings… restent utilisables : ce sont des raccourcis vers le niveau actif.
export const LEVEL_KEYS = ['walls', 'openings', 'rooms', 'furniture', 'dims', 'background'];
export function newLevel(id, name, height) {
  return { id, name, height, walls: [], openings: [], rooms: [], furniture: [], dims: [], background: null };
}
export function levelName(i) { return i === 0 ? 'Rez-de-chaussée' : i === 1 ? 'Étage (R+1)' : `Étage (R+${i})`; }

// Convertit un ancien projet (un seul niveau, tableaux à la racine) et rattache les raccourcis
export function bindDoc(d) {
  if (!Array.isArray(d.levels) || !d.levels.length) {
    const lv = newLevel('L1', d.project?.level || 'Rez-de-chaussée', d.settings?.wallHeight ?? DEFAULT_SETTINGS.wallHeight);
    for (const k of LEVEL_KEYS) if (Object.prototype.hasOwnProperty.call(d, k) && d[k] != null) lv[k] = d[k];
    d.levels = [lv];
  }
  for (const k of LEVEL_KEYS) delete d[k];
  d.version = 2;
  d.levels.forEach((lv, i) => {
    if (!lv.id) lv.id = 'L' + (i + 1);
    if (!lv.name) lv.name = levelName(i);
    if (!(lv.height > 0)) lv.height = d.settings?.wallHeight ?? DEFAULT_SETTINGS.wallHeight;
    for (const k of LEVEL_KEYS) if (k !== 'background' && !Array.isArray(lv[k])) lv[k] = [];
    if (lv.background === undefined) lv.background = null;
  });
  if (!(d.activeLevel >= 0 && d.activeLevel < d.levels.length)) d.activeLevel = 0;
  if (!Array.isArray(d.roofs)) d.roofs = [];
  const top = d.levels[d.levels.length - 1].id;
  for (const r of d.roofs) if (!d.levels.some((l) => l.id === r.level)) r.level = top;
  for (const k of LEVEL_KEYS) {
    Object.defineProperty(d, k, {
      enumerable: false, configurable: true,
      get() { return this.levels[this.activeLevel][k]; },
      set(v) { this.levels[this.activeLevel][k] = v; },
    });
  }
  return d;
}

export const store = { doc: newProject(), selection: null, geomVersion: 0 };
export const activeLevel = () => store.doc.levels[store.doc.activeLevel];
export const isTopLevel = () => store.doc.activeLevel === store.doc.levels.length - 1;

// Altitude de chaque niveau (z0 = sol fini du niveau, 0 = sol fini du rez-de-chaussée)
export function levelInfo() {
  const d = store.doc;
  let z = 0;
  return d.levels.map((level, index) => {
    const info = { level, index, z0: z, H: level.height, top: z + level.height };
    z += level.height + (d.settings.slabThickness || 20);
    return info;
  });
}
// Niveau voisin affiché en filigrane sous le plan (celui du dessous, sinon celui du dessus)
export function ghostLevel() {
  const d = store.doc;
  if (d.levels.length < 2 || d.settings.showGhost === false) return null;
  return d.levels[d.activeLevel > 0 ? d.activeLevel - 1 : 1];
}
export function buildingTop() { const L = levelInfo(); return L[L.length - 1].top; }
// Le niveau d'une toiture (celui dont elle couvre les murs)
export function roofLevelIndex(r) { const i = store.doc.levels.findIndex((l) => l.id === r.level); return i < 0 ? store.doc.levels.length - 1 : i; }
// Pièce « vide sur… » ou trémie d'escalier : pas de plancher, hors surface habitable
export const isVoidRoom = (name) => /tr[ée]mie|^vide\b|vide sur/i.test(name || '');
const listeners = [];
export function on(fn) { listeners.push(fn); }
export function uid(prefix) { return prefix + store.doc.nextId++; }

let cache = { v: -1 };
export function emit(kind = 'geometry') {
  if (kind === 'geometry') { store.geomVersion++; scheduleSave(); }
  for (const f of listeners) f(kind);
}

// ---------- Historique ----------
const undoStack = [], redoStack = [];
export function checkpoint() {
  undoStack.push(JSON.stringify(store.doc));
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
}
export function dropCheckpoint() { undoStack.pop(); }
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(store.doc));
  store.doc = bindDoc(JSON.parse(undoStack.pop()));
  store.selection = null;
  emit('geometry');
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(store.doc));
  store.doc = bindDoc(JSON.parse(redoStack.pop()));
  store.selection = null;
  emit('geometry');
  return true;
}
export function loadDoc(d) {
  const base = newProject();
  const raw = { ...d };
  if (!Array.isArray(raw.levels) || !raw.levels.length) for (const k of LEVEL_KEYS) raw[k] = d[k]; // ancien format (raccourcis non énumérables compris)
  if (!Array.isArray(d.levels) || !d.levels.length) delete base.levels;
  store.doc = bindDoc({ ...base, ...raw, project: { ...base.project, ...(d.project || {}) }, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } });
  undoStack.length = 0; redoStack.length = 0;
  store.selection = null;
  emit('geometry');
}

// ---------- Sauvegarde automatique (navigateur) ----------
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('archiplan.autosave', JSON.stringify(store.doc)); } catch (e) { /* stockage indisponible */ }
  }, 600);
}
export function loadAutosave() {
  try {
    const s = localStorage.getItem('archiplan.autosave');
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

// ---------- Données dérivées (mises en cache, par niveau) ----------
function compute(lv) {
  const topo = buildTopology(lv.walls);
  const geoms = computeWallGeoms(lv.walls);
  const rooms = [];
  const usedFaces = new Set();
  for (const r of lv.rooms) {
    const idx = topo.rooms.findIndex((f) => pointInPoly(r.seed, f.center));
    if (idx < 0) { rooms.push({ room: r, inner: null }); continue; }
    const f = topo.rooms[idx];
    rooms.push({ room: r, inner: f.inner, center: f.center, faceIndex: idx, area: area(f.inner), dup: usedFaces.has(idx) });
    usedFaces.add(idx);
  }
  // côté extérieur de chaque mur (+1 = côté n, -1 = côté -n, 0 = intérieur)
  const outside = new Map();
  for (const w of lv.walls) {
    const g = geoms.get(w.id);
    if (!g) continue;
    const mid = add(g.a, mul(g.d, g.L / 2));
    const test = (s) => topo.footprints.some((f) => pointInPoly(add(mid, mul(g.n, s * (g.t / 2 + 15))), f.outer));
    const inPlus = test(1), inMinus = test(-1);
    outside.set(w.id, inPlus && !inMinus ? -1 : !inPlus && inMinus ? 1 : 0);
  }
  return { topo, geoms, rooms, outside };
}
export function levelData(lv) {
  if (cache.v !== store.geomVersion || cache.doc !== store.doc) cache = { v: store.geomVersion, doc: store.doc, map: new Map() };
  let c = cache.map.get(lv);
  if (!c) { c = compute(lv); cache.map.set(lv, c); }
  return c;
}
const derived = () => levelData(activeLevel());
export const topo = () => derived().topo;
export const wallGeoms = () => derived().geoms;
export const resolvedRooms = () => derived().rooms;
export const outsideSide = (id) => derived().outside.get(id) || 0;
// Emprises de tous les niveaux
export function allFootprints() { return levelInfo().flatMap((L) => levelData(L.level).topo.footprints.map((fp) => ({ ...fp, levelIndex: L.index }))); }

// Crée les pièces manquantes et supprime les pièces orphelines/doublons
export function syncRooms(lv = activeLevel()) {
  const d = lv;
  const T = levelData(lv).topo;
  let changed = false;
  const keep = [];
  const used = new Set();
  const orphans = [];
  for (const r of d.rooms) {
    const idx = T.rooms.findIndex((f) => pointInPoly(r.seed, f.center));
    if (idx < 0 || used.has(idx)) { changed = true; orphans.push(r); continue; }
    used.add(idx);
    keep.push(r);
  }
  T.rooms.forEach((f, idx) => {
    if (used.has(idx)) return;
    const seed = interiorPoint(f.inner);
    // Réutilise une pièce orpheline proche (garde son nom quand les murs bougent)
    let best = null, bd = 300;
    for (const o of orphans) { const dd = Math.hypot(o.seed.x - seed.x, o.seed.y - seed.y); if (dd < bd) { bd = dd; best = o; } }
    if (best) { orphans.splice(orphans.indexOf(best), 1); best.seed = seed; keep.push(best); }
    else keep.push({ id: uid('r'), seed, name: 'Pièce ' + (keep.length + 1), floor: 'parquet' });
    changed = true;
  });
  if (changed) { d.rooms = keep; emit('geometry'); }
}

export function syncAllRooms() { for (const lv of store.doc.levels) syncRooms(lv); }

const notHabitable = (name) => /garage|terrasse/i.test(name) || isVoidRoom(name);
function levelStats(lv) {
  const D = levelData(lv);
  const rooms = D.rooms.filter((r) => r.inner && !r.dup);
  const habitable = rooms.filter((r) => !notHabitable(r.room.name)).reduce((s, r) => s + r.area, 0) / 1e4;
  const emprise = D.topo.footprints.reduce((s, f) => s + area(f.outer), 0) / 1e4;
  return { level: lv, rooms, habitable, emprise };
}
// rooms / habitable : niveau actif. habitableTotal : tous niveaux. emprise : plus grande emprise de niveau.
export function stats() {
  const per = store.doc.levels.map(levelStats);
  const cur = per[store.doc.activeLevel];
  return {
    rooms: cur.rooms, habitable: cur.habitable, perLevel: per,
    habitableTotal: per.reduce((s, p) => s + p.habitable, 0),
    emprise: Math.max(0, ...per.map((p) => p.emprise)),
    totalRooms: cur.rooms.reduce((s, r) => s + r.area, 0) / 1e4,
  };
}

export function fmtLen(cm) {
  const u = store.doc.settings.dimUnit;
  if (u === 'cm') return String(Math.round(cm));
  return (cm / 100).toFixed(2).replace('.', ',');
}
