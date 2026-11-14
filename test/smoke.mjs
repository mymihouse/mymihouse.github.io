// Test de fumée : exerce les moteurs sans navigateur (ctx canvas simulé)
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { store, loadDoc, syncRooms, syncAllRooms, stats, topo, resolvedRooms, levelInfo, newLevel, undo, checkpoint, emit } = await import('../js/model.js');
const fs = await import('node:fs');
const { buildExample } = await import('../js/example.js');
const { drawPlan, planExtents } = await import('../js/render2d.js');
const { buildFaces, projectedExtents, facadeFrame, FACADES, drawFacadesGrid, drawSection, sectionExtents } = await import('../js/elev.js');
const { drawMasse, masseExtents } = await import('../js/masse.js');
const { roofGeometry } = await import('../js/roof.js');

const calls = {};
const ctx = new Proxy({}, {
  get(_, k) {
    if (k === 'measureText') return () => ({ width: 40 });
    if (k === 'canvas') return { width: 1000, height: 800 };
    return (...a) => { calls[k] = (calls[k] || 0) + 1; };
  },
  set() { return true; },
});

loadDoc(buildExample());
syncRooms();
const st = stats();
console.log('Pièces :', st.rooms.map((r) => `${r.room.name} ${(r.area / 1e4).toFixed(2)}`).join(' | '));
console.log('Habitable', st.habitable.toFixed(2), 'm²  Emprise', st.emprise.toFixed(2), 'm²');
if (st.rooms.length !== 7) throw new Error('7 pièces attendues, ' + st.rooms.length);
if (st.rooms.some((r) => r.room.name.startsWith('Pièce'))) throw new Error('pièce non nommée');

const V = { scale: 0.6, ox: 100, oy: 100, w: 1200, h: 900, u: 1 };
drawPlan(ctx, V, {});
drawPlan(ctx, V, { print: true });
console.log('Plan rendu, extents', planExtents(true));
drawMasse(ctx, V); console.log('Masse ok', masseExtents());

const faces = buildFaces();
console.log('Faces 3D', faces.length);
for (const fc of FACADES) { const e = projectedExtents(facadeFrame(fc)); if (!e) throw new Error('façade vide ' + fc.key); console.log(fc.label, Math.round(e.maxX - e.minX), 'x', Math.round(e.maxZ - e.minZ)); }
if (!drawFacadesGrid(ctx, 1200, 800, 1)) throw new Error('façades non dessinées');
const se = sectionExtents(); if (!se) throw new Error('coupe vide');
if (!drawSection(ctx, { x: 0, y: 0, w: 1200, h: 800 }, 0.5, 1)) throw new Error('coupe non dessinée');
console.log('Coupe ok', se);
const r = store.doc.roofs[0];
for (const type of ['4pans', '2pans', 'plat']) { const g = roofGeometry({ ...r, type }); console.log(type, 'faces', g.faces.length, 'faîtage', g.ridgeZ.toFixed(0)); }
console.log('Appels canvas :', Object.keys(calls).length, 'méthodes');

// ---------- Plusieurs niveaux ----------
const assert = (c, m) => { if (!c) throw new Error(m); };
const d = store.doc;
assert(d.levels.length === 1 && d.walls === d.levels[0].walls, 'raccourci doc.walls → niveau actif');
assert(!Object.keys(JSON.parse(JSON.stringify(d))).includes('walls'), 'le fichier enregistré ne doit plus avoir de murs à la racine');
const h1 = projectedExtents(facadeFrame(FACADES[0]));
checkpoint();
const up = newLevel('N900', 'Étage (R+1)', 250);
let n = 9000;
for (const w of d.levels[0].walls) if (w.type === 'ext') up.walls.push({ ...w, id: 'w' + n++, a: { ...w.a }, b: { ...w.b } });
up.walls.push({ id: 'w' + n++, a: { x: 600, y: 0 }, b: { x: 600, y: 950 }, type: 'int', thickness: 10, height: 250 });
up.walls.push({ id: 'w' + n++, a: { x: 600, y: 300 }, b: { x: 1200, y: 300 }, type: 'int', thickness: 10, height: 250 });
up.openings.push({ id: 'o' + n++, wallId: up.walls[0].id, type: 'fenetre', pos: 300, width: 120, height: 125, sill: 95, side: 1, hinge: 'start' });
d.levels.push(up);
for (const r of d.roofs) { r.level = up.id; r.eave = 270 + 250; }
emit('geometry');
syncAllRooms();
const info = levelInfo();
assert(info[1].z0 === 270 && info[1].top === 520, 'altitude de l’étage : ' + info[1].z0);
assert(up.rooms.length === 3, '3 pièces attendues à l’étage, ' + up.rooms.length);
up.rooms.find((r) => r.seed.x > 600 && r.seed.y < 300).name = 'Trémie escalier';
emit('geometry');
const st2 = stats();
console.log('Niveaux :', st2.perLevel.map((p) => `${p.level.name} ${p.habitable.toFixed(2)} m²`).join(' | '), '→ total', st2.habitableTotal.toFixed(2));
assert(st2.rooms.length === 7 && Math.abs(st2.habitable - st.habitable) < 0.01, 'le niveau actif (RDC) garde ses 7 pièces');
assert(st2.habitableTotal > st2.habitable + 60, 'surface totale = RDC + étage');
assert(st2.perLevel[1].habitable < 95, 'la trémie ne compte pas dans la surface');
const h2 = projectedExtents(facadeFrame(FACADES[0]));
assert(Math.abs((h2.maxZ - h2.minZ) - (h1.maxZ - h1.minZ) - 270) < 1, 'la façade gagne 2,70 m : ' + (h2.maxZ - h2.minZ));
assert(buildFaces().length > faces.length + 20, 'faces de l’étage');
if (!drawFacadesGrid(ctx, 1200, 800, 1)) throw new Error('façades R+1');
if (!drawSection(ctx, { x: 0, y: 0, w: 1200, h: 800 }, 0.5, 1)) throw new Error('coupe R+1');
drawMasse(ctx, V);
d.activeLevel = 1; emit('geometry');
assert(store.doc.walls === up.walls && topo().rooms.length === 3, 'niveau actif = étage');
drawPlan(ctx, V, {}); drawPlan(ctx, V, { print: true });
assert(planExtents(true), 'emprise du plan d’étage');
undo();
assert(store.doc.levels.length === 1 && store.doc.walls.length === 10, 'annuler retire l’étage');
// Ancien fichier (un seul niveau, murs à la racine)
const old = JSON.parse(fs.readFileSync(new URL('../projets/R+1 - existant.archiplan.json', import.meta.url), 'utf8'));
loadDoc(old); syncAllRooms();
assert(store.doc.levels.length === 1 && store.doc.levels[0].name === 'Étage (R+1)' && store.doc.walls.length === 15 && store.doc.background, 'conversion de l’ancien format');
console.log('Ancien fichier converti :', store.doc.levels[0].name, stats().rooms.length, 'pièces', stats().habitable.toFixed(2), 'm²');
console.log('SMOKE OK');
