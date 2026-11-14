// Assistant : modifier le plan en tapant une phrase (« décale la cloison… », « volets verts »…)
// L'IA (Google Gemini, clé gratuite de l'utilisateur) reçoit une description du plan déjà analysée
// (quel mur sépare quelles pièces, de quel côté est le nord…) et renvoie une liste d'actions simples
// que ce module applique. Une seule étape d'annulation (Ctrl+Z) par demande.
import { store, emit, uid, checkpoint, levelData, syncRooms, activeLevel } from './model.js';
import * as G from './geom.js';
import { OPENING_TYPES, clampOpening } from './walls.js';
import { FURNITURE } from './furniture.js';
import { JOINERY_MATERIALS, JOINERY_COLORS, FINISHES, joinery } from './joinery.js';

const LS_KEY = 'mymi.geminiKey', LS_MODEL = 'mymi.geminiModel', LS_GOOD = 'mymi.geminiLastGood';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const ls = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* stockage indisponible */ } } };

// ---------- Description du plan pour l'IA ----------
const CARD = { nord: { x: 0, y: -1 }, sud: { x: 0, y: 1 }, est: { x: 1, y: 0 }, ouest: { x: -1, y: 0 } };
const dirName = (v) => (Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'est' : 'ouest') : v.y > 0 ? 'sud' : 'nord');
const r0 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;

function roomsOf(lv) { return levelData(lv).rooms.filter((r) => r.inner && !r.dup); }
function roomAt(lv, p) { return roomsOf(lv).find((r) => G.pointInPoly(p, r.inner)) || null; }
const roomCenter = (r) => G.interiorPoint(r.inner);
const roomLabel = (r) => (r ? `${r.room.name} (${r.room.id})` : null);

// Ce qu'il y a de chaque côté d'un mur
function wallSides(lv, w) {
  const D = levelData(lv), g = D.geoms.get(w.id);
  if (!g) return null;
  const mid = G.add(g.a, G.mul(g.d, g.L / 2));
  const out = D.outside.get(w.id) || 0;
  const sides = {};
  for (const s of [1, -1]) {
    const found = [];
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = G.add(G.add(g.a, G.mul(g.d, g.L * t)), G.mul(g.n, s * (g.t / 2 + 20)));
      const r = roomAt(lv, p);
      const lab = r ? roomLabel(r) : out === s ? 'extérieur' : null;
      if (lab && !found.includes(lab)) found.push(lab);
    }
    sides[dirName(G.mul(g.n, s))] = found.length ? found.join(' + ') : 'aucune pièce';
  }
  return { g, mid, sides, outDir: out ? dirName(G.mul(g.n, out)) : null };
}

export function describePlan() {
  const d = store.doc, s = d.settings;
  const levels = d.levels.map((lv, i) => {
    const rooms = roomsOf(lv).map((r) => {
      const b = G.bbox(r.inner);
      return { id: r.room.id, nom: r.room.name, surface_m2: r2(r.area / 1e4), sol: r.room.floor, centre: (() => { const c = roomCenter(r); return { x: r0(c.x), y: r0(c.y) }; })(), largeur_est_ouest_cm: r0(b.maxX - b.minX), profondeur_nord_sud_cm: r0(b.maxY - b.minY) };
    });
    const walls = lv.walls.map((w) => {
      const info = wallSides(lv, w);
      if (!info) return null;
      const o = { id: w.id, type: w.type === 'ext' ? 'mur extérieur' : 'cloison', de: { x: r0(w.a.x), y: r0(w.a.y) }, a: { x: r0(w.b.x), y: r0(w.b.y) }, longueur_cm: r0(info.g.L), orientation: Math.abs(info.g.d.x) > 0.9 ? 'est-ouest' : Math.abs(info.g.d.y) > 0.9 ? 'nord-sud' : 'biais', epaisseur_cm: w.thickness, hauteur_cm: w.height, cotes: info.sides };
      if (w.type === 'ext') { o.facade = info.outDir; o.parement = w.finish ? `${w.finish} ${w.finishColor}` : `par défaut (${s.facadeFinish} ${s.facadeColor})`; }
      return o;
    }).filter(Boolean);
    const openings = lv.openings.map((op) => {
      const w = lv.walls.find((x) => x.id === op.wallId); if (!w) return null;
      const info = wallSides(lv, w); if (!info) return null;
      const J = joinery(op);
      const c = G.add(info.g.a, G.mul(info.g.d, op.pos));
      const o = { id: op.id, type: op.type, libelle: OPENING_TYPES[op.type]?.label, mur: w.id, entre: Object.values(info.sides).join(' / '), centre: { x: r0(c.x), y: r0(c.y) }, pos_depuis_debut_mur_cm: r0(op.pos), largeur_cm: op.width, hauteur_cm: op.height, allege_cm: op.sill };
      if (info.outDir) o.facade = info.outDir;
      if (J.kind !== 'door' || op.type === 'entree') Object.assign(o, { materiau: J.material, couleur: J.color, vantaux: J.leaves, imposte_cm: J.transom || 0, petits_bois_verticaux: J.barsX || 0, petits_bois_horizontaux: J.barsY || 0 });
      return o;
    }).filter(Boolean);
    const furniture = lv.furniture.map((f) => ({ id: f.id, type: f.type, libelle: FURNITURE[f.type]?.label, piece: roomLabel(roomAt(lv, f)), x: r0(f.x), y: r0(f.y), rotation: f.rot }));
    return { index: i, nom: lv.name, hauteur_cm: lv.height, actif: i === d.activeLevel, pieces: rooms, murs: walls, ouvertures: openings, meubles: furniture };
  });
  return {
    selection: store.selection ? { type: store.selection.type, id: store.selection.id } : null,
    reglages: { parement_facades_par_defaut: s.facadeFinish, couleur_facades_par_defaut: s.facadeColor, materiau_menuiseries_par_defaut: s.joineryMaterial, couleur_menuiseries_par_defaut: s.joineryColor },
    niveaux: levels,
  };
}

const SYSTEM = () => `Tu es l'assistant de MymiHouseBoucletteBuilder, un logiciel de plans de maison en français.
L'utilisateur te demande une modification du plan en langage courant. Tu réponds UNIQUEMENT par un objet JSON :
{"actions":[...], "message":"phrase courte en français pour l'utilisateur"}

REPÈRE : coordonnées en centimètres. x augmente vers l'EST, y augmente vers le SUD (le nord est en haut du plan, y plus petit).
Chaque mur a deux côtés ("cotes") : la pièce de chaque côté et sa direction (nord/sud/est/ouest). Sers-t'en pour trouver
« la cloison entre X et Y » et dans quel sens la déplacer. « Agrandir la pièce X de N cm » = déplacer un de ses murs en l'éloignant
de X (vers la pièce voisine). Les identifiants (w…, o…, r…, f…) viennent du plan fourni : n'en invente jamais.
Un mur qui longe plusieurs pièces (« Salle de bains + WC ») les modifie toutes quand on le déplace : signale-le dans le message.
Si la demande est ambiguë ou impossible, renvoie "actions": [] et pose une question claire dans "message".
Si l'utilisateur dit « ce mur », « cette fenêtre »… utilise "selection".
Les distances données en mètres (« 0,30 m », « 1m20 ») sont à convertir en cm.

ACTIONS POSSIBLES (champ "op") :
- {"op":"moveWall","wall":"w12","distance":30,"direction":"nord|sud|est|ouest"} ou {"op":"moveWall","wall":"w12","distance":30,"towardRoom":"r5"}
  Déplace le mur parallèlement à lui-même ; les murs qui le touchent suivent. towardRoom = vers (dans) cette pièce, ce qui la réduit.
- {"op":"setWall","walls":["w1","w2"],"finish":"<parement>"|null,"finishColor":"#hex","thickness":20,"type":"ext|int","height":250}
  (finish null = revenir au parement par défaut). Ne mets que les champs à changer.
- {"op":"setOpening","openings":["o3"],"type":"<type>","width":120,"height":125,"sill":95,"pos":200,"material":"pvc|alu|bois","color":"#hex","leaves":2,"transom":0,"barsX":0,"barsY":0,"flipSide":true,"flipHinge":true}
  (pos = distance du début du mur au centre de l'ouverture ; transom = hauteur d'imposte en cm, 0 = aucune ; flipSide/flipHinge = inverser le sens d'ouverture). Ne mets que les champs à changer.
- {"op":"addOpening","wall":"w4","type":"<type>","pos":250,"width":120,"height":125,"sill":95}  (pos omis = milieu du mur)
- {"op":"addFurniture","type":"<meuble>","room":"r3","rotation":0}  ou avec "x","y" au lieu de "room"
- {"op":"moveFurniture","id":"f8","dx":0,"dy":-50,"rotation":90}  (dx vers l'est, dy vers le sud ; ou "x","y" absolus)
- {"op":"setRoom","room":"r5","name":"Bureau","floor":"parquet|carrelage|beton|moquette"}
- {"op":"delete","ids":["o3","f8","w9"]}
- {"op":"setDefaults","facadeFinish":"<parement>","facadeColor":"#hex","joineryMaterial":"pvc|alu|bois","joineryColor":"#hex"}
  (parement et menuiseries par défaut de toute la maison ; pour TOUTES les fenêtres existantes utilise plutôt setOpening avec leurs ids)
- {"op":"setLevelHeight","level":0,"height":260}

Types d'ouverture : ${Object.entries(OPENING_TYPES).map(([k, v]) => `${k} (${v.label})`).join(', ')}.
Parements : ${Object.entries(FINISHES).map(([k, v]) => `${k} (${v.label} ; teintes : ${v.colors.map(([c, n]) => `${n} ${c}`).join(', ')})`).join(' | ')}.
Couleurs de menuiserie usuelles : ${JOINERY_COLORS.map((c) => `${c.n} ${c.c}`).join(', ')}. Une autre couleur demandée (ex. vert sauge) : donne un code #hex adapté.
Matériaux de menuiserie : ${Object.entries(JOINERY_MATERIALS).map(([k, v]) => `${k} (${v})`).join(', ')}.
Meubles : ${Object.entries(FURNITURE).map(([k, v]) => `${k} (${v.label})`).join(', ')}.
Le "message" résume ce que tu as fait (ex. « Cloison décalée de 30 cm vers le sud : la chambre 2 gagne 0,9 m². »), sans jargon ni identifiants.`;

// ---------- Application des actions ----------
function findIn(kind, id) {
  const d = store.doc;
  const order = [d.activeLevel, ...d.levels.map((_, i) => i).filter((i) => i !== d.activeLevel)];
  for (const i of order) { const x = d.levels[i][kind].find((o) => o.id === id); if (x) return { lv: d.levels[i], li: i, obj: x }; }
  return null;
}
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(+v.replace(',', '.')) ? +v.replace(',', '.') : null);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Mémorise la position absolue des ouvertures des murs touchés pour la restaurer après un déplacement
function rememberOpenings(lv, wallIds) {
  const D = levelData(lv);
  return lv.openings.filter((o) => wallIds.has(o.wallId)).map((o) => { const g = D.geoms.get(o.wallId); return { o, c: g ? G.add(g.a, G.mul(g.d, o.pos)) : null }; });
}
function restoreOpenings(lv, mem) {
  for (const { o, c } of mem) { const w = lv.walls.find((x) => x.id === o.wallId); if (!w || !c) continue; const dir = G.norm(G.sub(w.b, w.a)); o.pos = G.dot(G.sub(c, w.a), dir); }
}

function moveWall(a, done) {
  const f = findIn('walls', a.wall); if (!f) throw new Error(`mur ${a.wall} introuvable`);
  const { lv, obj: w } = f;
  const dist = num(a.distance); if (dist == null || dist <= 0 || dist > 2000) throw new Error('distance invalide');
  const g = levelData(lv).geoms.get(w.id); if (!g) throw new Error('mur trop court');
  let s;
  if (a.towardRoom) {
    const r = roomsOf(lv).find((x) => x.room.id === a.towardRoom); if (!r) throw new Error(`pièce ${a.towardRoom} introuvable`);
    const mid = G.add(g.a, G.mul(g.d, g.L / 2));
    s = Math.sign(G.dot(G.sub(roomCenter(r), mid), g.n)) || 1;
  } else {
    const v = CARD[String(a.direction || '').toLowerCase()]; if (!v) throw new Error('direction manquante');
    const p = G.dot(v, g.n);
    if (Math.abs(p) < 0.5) throw new Error(`ce mur est orienté ${Math.abs(g.d.x) > 0.7 ? 'est-ouest' : 'nord-sud'}, il ne peut pas aller vers ${/^[eo]/.test(a.direction) ? 'l’' : 'le '}${a.direction}`);
    s = Math.sign(p);
  }
  const vec = G.mul(g.n, s * dist);
  const A0 = G.clone(w.a), B0 = G.clone(w.b);
  const near = (p, q) => G.dist(p, q) < 1.5;
  const touched = new Set([w.id]);
  const moves = [], connectors = [];
  for (const x of lv.walls) {
    if (x === w) continue;
    for (const end of ['a', 'b']) {
      const p = x[end];
      const atNode = near(p, A0) || near(p, B0);
      const pr = G.projectOnSegment(p, A0, B0);
      const onBody = !atNode && pr.d < 1.5 && pr.t > 0.001 && pr.t < 0.999;
      if (!atNode && !onBody) continue;
      const xd = G.norm(G.sub(x.b, x.a));
      const collinear = Math.abs(G.cross(xd, g.d)) < 0.05;
      if (collinear) { if (atNode) connectors.push(G.clone(p)); continue; } // prolongement : on ajoute un petit retour
      moves.push([x, end]); touched.add(x.id);
    }
  }
  const mem = rememberOpenings(lv, touched);
  w.a = G.add(A0, vec); w.b = G.add(B0, vec);
  for (const [x, end] of moves) x[end] = G.add(x[end], vec);
  for (const p of connectors) {
    if (lv.walls.some((x) => x !== w && ((near(x.a, p) && near(x.b, G.add(p, vec))) || (near(x.b, p) && near(x.a, G.add(p, vec)))))) continue;
    lv.walls.push({ id: uid('w'), a: G.clone(p), b: G.add(p, vec), type: w.type, thickness: w.thickness, height: w.height });
  }
  restoreOpenings(lv, mem);
  done.walls.add(lv);
}

function apply1(a, done) {
  const d = store.doc;
  switch (a.op) {
    case 'moveWall': return moveWall(a, done);
    case 'setWall': {
      const ids = list(a.walls || a.wall); if (!ids.length) throw new Error('aucun mur');
      for (const id of ids) {
        const f = findIn('walls', id); if (!f) throw new Error(`mur ${id} introuvable`);
        const w = f.obj;
        if ('finish' in a) {
          if (a.finish === null || a.finish === '' || a.finish === 'defaut') { delete w.finish; delete w.finishColor; }
          else if (FINISHES[a.finish]) { w.finish = a.finish; w.finishColor = isHex(a.finishColor) ? a.finishColor : FINISHES[a.finish].colors[0][0]; }
          else throw new Error(`parement inconnu : ${a.finish}`);
        } else if (isHex(a.finishColor)) { if (!w.finish) w.finish = d.settings.facadeFinish; w.finishColor = a.finishColor; }
        if (num(a.thickness) > 0) w.thickness = Math.min(80, num(a.thickness));
        if (a.type === 'ext' || a.type === 'int') w.type = a.type;
        if (num(a.height) > 0) w.height = Math.min(800, num(a.height));
        done.walls.add(f.lv);
      }
      return;
    }
    case 'setOpening': {
      const ids = list(a.openings || a.opening || a.id); if (!ids.length) throw new Error('aucune ouverture');
      for (const id of ids) {
        const f = findIn('openings', id); if (!f) throw new Error(`ouverture ${id} introuvable`);
        const o = f.obj;
        if (a.type && OPENING_TYPES[a.type] && a.type !== o.type) { const T = OPENING_TYPES[a.type]; Object.assign(o, { type: a.type, width: T.width, height: T.height, sill: T.sill }); delete o.leaves; }
        for (const k of ['width', 'height', 'sill', 'pos', 'leaves', 'transom', 'barsX', 'barsY']) if (num(a[k]) != null) o[k] = Math.max(0, num(a[k]));
        if (a.material && JOINERY_MATERIALS[a.material]) o.material = a.material;
        if (isHex(a.color)) o.color = a.color;
        if (a.flipSide) o.side = -(o.side || 1);
        if (a.flipHinge) o.hinge = o.hinge === 'end' ? 'start' : 'end';
        if (o.leaves != null) o.leaves = Math.min(6, Math.max(1, Math.round(o.leaves)));
        const g = levelData(f.lv).geoms.get(o.wallId); if (g) clampOpening(o, g);
        done.geom = true;
      }
      return;
    }
    case 'addOpening': {
      const f = findIn('walls', a.wall); if (!f) throw new Error(`mur ${a.wall} introuvable`);
      const T = OPENING_TYPES[a.type]; if (!T) throw new Error(`type d'ouverture inconnu : ${a.type}`);
      const g = levelData(f.lv).geoms.get(f.obj.id); if (!g) throw new Error('mur trop court');
      const out = levelData(f.lv).outside.get(f.obj.id) || 0;
      const o = { id: uid('o'), wallId: f.obj.id, type: a.type, pos: num(a.pos) ?? g.L / 2, width: num(a.width) || T.width, height: num(a.height) || T.height, sill: num(a.sill) ?? T.sill, side: out ? -out : 1, hinge: 'start' };
      if (o.height + o.sill > f.obj.height) o.height = f.obj.height - o.sill - 5;
      clampOpening(o, g);
      f.lv.openings.push(o); done.geom = true; done.focus = f.li;
      return;
    }
    case 'addFurniture': {
      const def = FURNITURE[a.type]; if (!def) throw new Error(`meuble inconnu : ${a.type}`);
      let lv = activeLevel(), x = num(a.x), y = num(a.y);
      if (a.room) {
        const li = d.levels.findIndex((L) => roomsOf(L).some((r) => r.room.id === a.room)); if (li < 0) throw new Error(`pièce ${a.room} introuvable`);
        lv = d.levels[li]; const r = roomsOf(lv).find((q) => q.room.id === a.room); ({ x, y } = roomCenter(r)); done.focus = li;
      }
      if (x == null || y == null) throw new Error('position du meuble manquante');
      lv.furniture.push({ id: uid('f'), type: a.type, x, y, rot: ((num(a.rotation) || 0) % 360 + 360) % 360, w: def.w, d: def.d, h: def.h });
      done.geom = true; return;
    }
    case 'moveFurniture': {
      const f = findIn('furniture', a.id || a.furniture); if (!f) throw new Error(`meuble ${a.id} introuvable`);
      const m = f.obj;
      if (num(a.x) != null) m.x = num(a.x); if (num(a.y) != null) m.y = num(a.y);
      if (num(a.dx) != null) m.x += num(a.dx); if (num(a.dy) != null) m.y += num(a.dy);
      if (num(a.rotation) != null) m.rot = ((num(a.rotation) % 360) + 360) % 360;
      done.geom = true; return;
    }
    case 'setRoom': {
      const f = findIn('rooms', a.room); if (!f) throw new Error(`pièce ${a.room} introuvable`);
      if (typeof a.name === 'string' && a.name.trim()) f.obj.name = a.name.trim().slice(0, 60);
      if (['parquet', 'carrelage', 'beton', 'moquette'].includes(a.floor)) f.obj.floor = a.floor;
      done.geom = true; return;
    }
    case 'delete': {
      for (const id of list(a.ids || a.id)) {
        let f;
        if ((f = findIn('walls', id))) { f.lv.walls = f.lv.walls.filter((w) => w.id !== id); f.lv.openings = f.lv.openings.filter((o) => o.wallId !== id); done.walls.add(f.lv); }
        else if ((f = findIn('openings', id))) { f.lv.openings = f.lv.openings.filter((o) => o.id !== id); done.geom = true; }
        else if ((f = findIn('furniture', id))) { f.lv.furniture = f.lv.furniture.filter((o) => o.id !== id); done.geom = true; }
        else throw new Error(`élément ${id} introuvable`);
        if (store.selection?.id === id) store.selection = null;
      }
      return;
    }
    case 'setDefaults': {
      const s = d.settings;
      if (a.facadeFinish && FINISHES[a.facadeFinish]) { s.facadeFinish = a.facadeFinish; s.facadeColor = FINISHES[a.facadeFinish].colors[0][0]; }
      if (isHex(a.facadeColor)) s.facadeColor = a.facadeColor;
      if (a.joineryMaterial && JOINERY_MATERIALS[a.joineryMaterial]) s.joineryMaterial = a.joineryMaterial;
      if (isHex(a.joineryColor)) s.joineryColor = a.joineryColor;
      done.geom = true; return;
    }
    case 'setLevelHeight': {
      const lv = d.levels[num(a.level) ?? d.activeLevel]; const h = num(a.height);
      if (!lv || !(h >= 180 && h <= 600)) throw new Error('niveau ou hauteur invalide');
      lv.height = h; for (const w of lv.walls) w.height = h; if (lv === d.levels[0]) d.settings.wallHeight = h;
      done.geom = true; return;
    }
    default: throw new Error(`action inconnue : ${a.op}`);
  }
}

// Applique toutes les actions en une seule étape d'annulation. Renvoie { ok, errors, focus }.
export function applyActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return { ok: 0, errors: [] };
  const before = JSON.stringify(store.doc);
  checkpoint();
  const done = { walls: new Set(), geom: false, focus: null };
  const errors = [];
  let ok = 0;
  for (const a of actions) {
    try { apply1(a || {}, done); ok++; } catch (e) { errors.push(e.message); }
    store.geomVersion++; // invalide le cache entre deux actions
  }
  for (const lv of done.walls) {
    const D = levelData(lv);
    lv.openings = lv.openings.filter((o) => { const g = D.geoms.get(o.wallId); if (!g) return false; clampOpening(o, g); return g.L > o.width * 0.6; });
  }
  emit('geometry');
  for (const lv of done.walls) syncRooms(lv);
  if (!ok) { /* rien n'a changé : on retire l'étape d'annulation inutile */ if (JSON.stringify(store.doc) === before) undoLastCheckpoint(); }
  return { ok, errors, focus: done.focus };
}
let undoLastCheckpoint = () => {};

// ---------- Appel à Gemini ----------
let history = [];
export const getKey = () => ls.get(LS_KEY);
export function setKey(k) { ls.set(LS_KEY, (k || '').trim()); ls.set(LS_GOOD, ''); modelCache = { key: null, list: null }; }

async function gfetch(path, key, body) {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* pas de JSON */ }
  if (!r.ok) { const err = new Error(j?.error?.message || `HTTP ${r.status}`); err.status = r.status; err.reason = j?.error?.status; throw err; }
  return j;
}

// Modèles disponibles pour cette clé : Flash (meilleur) d'abord, Flash-Lite (quota gratuit plus large) en secours
let modelCache = { key: null, list: null };
export async function listModels(key = getKey()) {
  if (modelCache.key === key && modelCache.list) return modelCache.list;
  const j = await gfetch('/models?pageSize=200', key);
  const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const rank = (n) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2) + (/preview|exp/.test(n) ? 0.5 : 0);
  const res = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && !/(tts|image|vision|embed|live|audio|thinking|computer|robotics|nano|learnlm|-8b)/.test(n) && !/pro/.test(n))
    .sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
  modelCache = { key, list: res };
  return res;
}

function parseJSON(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('réponse illisible'); }
}

export async function ask(text) {
  const key = getKey(); if (!key) { const e = new Error('Aucune clé'); e.noKey = true; throw e; }
  const plan = JSON.stringify(describePlan());
  const contents = [...history, { role: 'user', parts: [{ text: `PLAN ACTUEL (JSON) :\n${plan}\n\nDEMANDE : ${text}` }] }];
  const body = { systemInstruction: { parts: [{ text: SYSTEM() }] }, contents, generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } };
  const chosen = ls.get(LS_MODEL);
  let candidates = chosen ? [chosen] : [];
  if (!chosen) { const good = ls.get(LS_GOOD); try { candidates = await listModels(key); } catch (e) { if (e.status === 400 || e.status === 403) throw keyError(e); throw e; } if (good && candidates.includes(good)) candidates = [good, ...candidates.filter((m) => m !== good)]; candidates = candidates.slice(0, 4); }
  if (!candidates.length) throw new Error('Aucun modèle Gemini disponible pour cette clé.');
  let last;
  for (const model of candidates) {
    try {
      const j = await gfetch(`/models/${encodeURIComponent(model)}:generateContent`, key, body);
      const parts = j.candidates?.[0]?.content?.parts || [];
      const out = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!out) throw new Error(j.candidates?.[0]?.finishReason === 'SAFETY' ? 'réponse bloquée' : 'réponse vide');
      const res = parseJSON(out);
      ls.set(LS_GOOD, model);
      history = [...history, { role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: out }] }].slice(-8);
      return { model, actions: Array.isArray(res.actions) ? res.actions : [], message: typeof res.message === 'string' ? res.message : '' };
    } catch (e) {
      last = e;
      if (e.status === 400 && /api key|API_KEY/i.test(e.message)) throw keyError(e);
      if (e.status === 403) throw keyError(e);
      if (chosen) break;
      if (![404, 429, 500, 503].includes(e.status) && e.message !== 'réponse illisible' && e.message !== 'réponse vide') break;
    }
  }
  if (last?.status === 429) { const e = new Error('Quota gratuit atteint pour le moment. Réessayez dans une minute (ou demain si la limite du jour est atteinte).'); throw e; }
  throw last;
}
function keyError(e) { const x = new Error('Clé refusée par Google. Vérifiez-la dans les réglages de l’assistant (⚙).'); x.noKey = true; x.detail = e.message; return x; }
export function resetConversation() { history = []; }

// ---------- Interface ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initAssistant(h) {
  // h : { stage, toggleBtn, undo, setLevel, toast }
  undoLastCheckpoint = h.dropCheckpoint || (() => {});
  const box = document.createElement('div');
  box.id = 'assist';
  box.innerHTML = `
    <div class="as-log" id="asLog"></div>
    <form class="as-form" id="asForm" autocomplete="off">
      <span class="as-ic">✨</span>
      <input id="asInput" placeholder="Ex. « agrandis la chambre 1 de 30 cm vers la salle de bains » ou « fenêtres en gris anthracite »">
      <button class="btn primary small" id="asSend" type="submit">Envoyer</button>
      <button class="btn small" type="button" id="asGear" title="Réglages de l'assistant (clé Gemini)">⚙</button>
      <button class="btn small" type="button" id="asClose" title="Fermer">×</button>
    </form>`;
  h.stage.appendChild(box);

  const modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'asSettings';
  modal.innerHTML = `<div class="box">
    <button class="btn close" id="asSetClose">Fermer</button>
    <h2>Assistant : réglages</h2>
    <p>L'assistant utilise l'IA <b>Google Gemini</b>. Il faut une <b>clé gratuite</b> (2 minutes) :</p>
    <ol>
      <li>Ouvrez <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> et connectez-vous avec un compte Google.</li>
      <li>Cliquez sur <b>« Create API key »</b> (Créer une clé), puis copiez-la.</li>
      <li>Collez-la ci-dessous et cliquez sur <b>Enregistrer</b>.</li>
    </ol>
    <div class="as-keyrow"><input type="password" id="asKey" placeholder="Collez votre clé ici (commence souvent par AIza…)"><button class="btn primary" id="asKeySave">Enregistrer</button><button class="btn" id="asKeyDel">Oublier</button></div>
    <div class="as-keyrow"><label>Modèle :</label><select id="asModel"><option value="">Automatique (recommandé)</option></select><button class="btn" id="asTest">Tester la clé</button></div>
    <p class="as-status" id="asStatus"></p>
    <p class="as-note">La clé reste dans <b>ce navigateur</b>, sur cet ordinateur ; elle n'est envoyée qu'à Google. À chaque demande, l'assistant envoie à Google la description du plan (pièces, murs, dimensions), sans le nom du projet ni l'adresse. Sur l'offre gratuite, Google limite le nombre de demandes par jour (quand la limite du meilleur modèle est atteinte, l'assistant passe tout seul à un modèle plus léger) et peut utiliser ces données pour améliorer ses modèles.</p>
  </div>`;
  document.body.appendChild(modal);

  const $ = (s) => document.querySelector(s);
  const log = $('#asLog'), input = $('#asInput'), status = $('#asStatus');
  const open = (v) => { box.classList.toggle('show', v); h.toggleBtn?.classList.toggle('on', v); if (v) setTimeout(() => input.focus(), 30); };
  const addMsg = (cls, html) => { const el = document.createElement('div'); el.className = 'as-msg ' + cls; el.innerHTML = html; log.appendChild(el); while (log.children.length > 6) log.firstChild.remove(); log.scrollTop = log.scrollHeight; return el; };
  const fillModels = async () => {
    const sel = $('#asModel'), cur = ls.get(LS_MODEL);
    sel.innerHTML = '<option value="">Automatique (recommandé)</option>';
    if (!getKey()) return;
    try { const ms = await listModels(); for (const m of ms) sel.insertAdjacentHTML('beforeend', `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`); status.textContent = `Clé valide ✓ (${ms.length} modèles disponibles${ms[0] ? ', automatique : ' + ms[0] : ''})`; status.className = 'as-status ok'; }
    catch (e) { status.textContent = 'Clé refusée ou réseau indisponible : ' + e.message; status.className = 'as-status err'; }
  };
  const openSettings = () => { $('#asKey').value = getKey(); status.textContent = getKey() ? '' : 'Aucune clé enregistrée.'; status.className = 'as-status'; modal.classList.add('show'); fillModels(); };

  h.toggleBtn?.addEventListener('click', () => open(!box.classList.contains('show')));
  $('#asClose').onclick = () => open(false);
  $('#asGear').onclick = openSettings;
  $('#asSetClose').onclick = () => modal.classList.remove('show');
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
  $('#asKeySave').onclick = () => { setKey($('#asKey').value); status.textContent = 'Vérification…'; fillModels(); };
  $('#asKeyDel').onclick = () => { setKey(''); ls.set(LS_MODEL, ''); $('#asKey').value = ''; fillModels(); status.textContent = 'Clé oubliée.'; status.className = 'as-status'; };
  $('#asTest').onclick = () => { if ($('#asKey').value.trim() !== getKey()) setKey($('#asKey').value); status.textContent = 'Vérification…'; fillModels(); };
  $('#asModel').onchange = (e) => ls.set(LS_MODEL, e.target.value);

  let busy = false;
  $('#asForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text || busy) return;
    if (!getKey()) { openSettings(); return; }
    busy = true; $('#asSend').disabled = true; input.value = '';
    addMsg('me', esc(text));
    const wait = addMsg('ai pending', 'Je regarde le plan…');
    try {
      const r = await ask(text);
      const res = applyActions(r.actions);
      if (res.focus != null && res.focus !== store.doc.activeLevel) h.setLevel?.(res.focus);
      let html = esc(r.message || (res.ok ? 'C’est fait.' : 'Je n’ai rien modifié.'));
      if (res.errors.length) html += `<div class="as-err">Pas pu faire : ${res.errors.map(esc).join(' ; ')}</div>`;
      if (res.ok) html += ` <button class="as-undo" type="button">Annuler</button>`;
      wait.className = 'as-msg ai'; wait.innerHTML = html;
      wait.querySelector('.as-undo')?.addEventListener('click', (ev) => { h.undo(); ev.target.replaceWith(Object.assign(document.createElement('i'), { textContent: ' (annulé)' })); });
    } catch (err) {
      wait.className = 'as-msg ai err'; wait.textContent = err.message || String(err);
      if (err.noKey) openSettings();
    }
    busy = false; $('#asSend').disabled = false; input.focus();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.blur(); } });
  return { open };
}
