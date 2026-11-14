// Test de l'assistant sans IA : description du plan + application d'actions simulées
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { store, loadDoc, syncAllRooms, stats, undo } = await import('../js/model.js');
const { describePlan, applyActions } = await import('../js/assistant.js');
const fs = await import('node:fs');
const file = process.argv[2] || new URL('./demo-2-niveaux.archiplan.json', import.meta.url);
loadDoc(JSON.parse(fs.readFileSync(file, 'utf8'))); syncAllRooms();
const D = describePlan();
const txt = JSON.stringify(D);
console.log('Description :', txt.length, 'caractères ;', D.niveaux.map((n) => `${n.nom}: ${n.pieces.length} pièces, ${n.murs.length} murs, ${n.ouvertures.length} ouvertures`).join(' | '));
const area = (name) => stats().rooms.find((r) => r.room.name === name)?.area / 1e4;
const lv = D.niveaux[store.doc.activeLevel];
// cloison entre deux pièces nommées
const pick = process.argv[3] && process.argv[4] ? [process.argv[3], process.argv[4]] : [lv.pieces[0].nom, lv.pieces[1].nom];
const w = lv.murs.find((m) => m.type === 'cloison' && Object.values(m.cotes).some((c) => c.includes(pick[0] + ' (')) && Object.values(m.cotes).some((c) => c.includes(pick[1] + ' (')));
if (!w) { console.log('Pas de cloison commune entre', pick); process.exit(0); }
console.log('Cloison trouvée :', w.id, w.orientation, JSON.stringify(w.cotes));
const r2 = lv.pieces.find((p) => p.nom === pick[1]);
const a0 = area(pick[0]), b0 = area(pick[1]);
const res = applyActions([{ op: 'moveWall', wall: w.id, distance: 30, towardRoom: r2.id }]);
const a1 = area(pick[0]), b1 = area(pick[1]);
console.log(`moveWall → ok=${res.ok} err=${res.errors}  ${pick[0]} ${a0.toFixed(2)}→${a1.toFixed(2)} m² ; ${pick[1]} ${b0.toFixed(2)}→${b1.toFixed(2)} m²`);
if (!(a1 > a0 && b1 < b0)) throw new Error('le déplacement n’a pas agrandi la bonne pièce');
const nRooms = stats().rooms.length;
undo(); syncAllRooms();
console.log('Annuler →', area(pick[0]).toFixed(2), 'm² (attendu', a0.toFixed(2) + ')');
if (Math.abs(area(pick[0]) - a0) > 0.01) throw new Error('annulation ratée');
// couleurs / parements / erreurs
const fen = lv.ouvertures.filter((o) => o.type === 'fenetre').map((o) => o.id);
const ext = lv.murs.filter((m) => m.type === 'mur extérieur' && m.facade === 'nord').map((m) => m.id);
const r = applyActions([{ op: 'setOpening', openings: fen, color: '#8a9a7b', leaves: 3 }, { op: 'setWall', walls: ext, finish: 'bardageV', finishColor: '#2b2b2b' }, { op: 'moveWall', wall: 'w99999', distance: 10, direction: 'nord' }, { op: 'moveWall', wall: w.id, distance: 10, direction: w.orientation === 'nord-sud' ? 'nord' : 'est' }]);
console.log(`couleurs/parements → ok=${r.ok}, erreurs attendues : ${r.errors.join(' | ')}`);
const o = store.doc.openings.find((x) => x.id === fen[0]);
if (o && (o.color !== '#8a9a7b' || o.leaves !== 3)) throw new Error('fenêtre non modifiée');
if (r.errors.length !== 2) throw new Error('erreurs attendues : 2');
console.log('Pièces avant/après :', nRooms, stats().rooms.length);
console.log('ASSISTANT OK');
