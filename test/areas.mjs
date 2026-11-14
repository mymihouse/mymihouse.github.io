// Affiche les surfaces calculées par MymiHouseBoucletteBuilder pour un fichier projet : node test/areas.mjs "projets/xxx.json"
globalThis.localStorage = { getItem: () => null, setItem() {} };
const fs = await import('node:fs');
const { loadDoc, syncRooms, stats, store } = await import('../js/model.js');
const file = process.argv[2];
loadDoc(JSON.parse(fs.readFileSync(file, 'utf8')));
const before = store.doc.rooms.map((r) => r.name).join(',');
syncRooms();
const st = stats();
console.log('==', store.doc.project.name);
for (const r of st.rooms) console.log(`  ${r.room.name.padEnd(22)} ${(r.area / 1e4).toFixed(2)} m²`);
if (store.doc.rooms.map((r) => r.name).join(',') !== before) console.log('  ! pièces ajoutées/supprimées par la synchro :', store.doc.rooms.map((r) => r.name).join(', '));
