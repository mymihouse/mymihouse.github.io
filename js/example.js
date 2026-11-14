// Maison d'exemple (T3 de plain-pied) pour démarrer vite
import { newProject } from './model.js';
import { OPENING_TYPES } from './walls.js';
import { buildTopology } from './topology.js';
import { interiorPoint, pointInPoly } from './geom.js';

export function buildExample() {
  const d = newProject();
  d.project.name = 'Maison exemple T3';
  d.project.address = '1 rue de l’Exemple, 00000 Ville';
  d.project.parcelRef = 'Section AB n° 123';
  let id = 1;
  const H = d.settings.wallHeight;
  const W = (ax, ay, bx, by, type) => { const w = { id: 'w' + id++, a: { x: ax, y: ay }, b: { x: bx, y: by }, type, thickness: type === 'ext' ? 30 : 10, height: H }; d.walls.push(w); return w; };
  const O = (w, type, pos, side = 1, hinge = 'start') => { const t = OPENING_TYPES[type]; d.openings.push({ id: 'o' + id++, wallId: w.id, type, pos, width: t.width, height: t.height, sill: t.sill, side, hinge }); };
  const F = (type, x, y, rot = 0, w, dd, h) => { const def = FURN[type]; d.furniture.push({ id: 'f' + id++, type, x, y, rot, w: w ?? def.w, d: dd ?? def.d, h: h ?? def.h }); };

  // Murs extérieurs 12 m × 9,5 m (axes)
  const top = W(0, 0, 1200, 0, 'ext');
  const right = W(1200, 0, 1200, 950, 'ext');
  const bottom = W(1200, 950, 0, 950, 'ext');
  const left = W(0, 950, 0, 0, 'ext');
  // Cloisons
  const v1 = W(450, 0, 450, 950, 'int');
  const h1 = W(0, 380, 450, 380, 'int');
  const h2 = W(0, 600, 450, 600, 'int');
  const v2 = W(250, 380, 250, 600, 'int');
  const h3 = W(450, 600, 1200, 600, 'int');
  const v3 = W(800, 600, 800, 950, 'int');

  // Ouvertures (pos mesurée depuis le point a du mur)
  O(top, 'fenetre', 225); O(top, 'fenetre', 700); O(top, 'fenetre', 1000);
  O(right, 'baie', 300); O(right, 'fenetre', 775);
  O(bottom, 'fenetre', 1200 - 1000); O(bottom, 'entree', 1200 - 625, 1, 'end'); O(bottom, 'fenetre', 1200 - 225);
  O(left, 'fenetre', 950 - 775); O(left, 'petite', 950 - 490); O(left, 'fenetre', 950 - 190);
  O(h3, 'porte', 625 - 450, -1);          // entrée → séjour
  O(v3, 'porte', 775 - 600, 1);           // entrée → bureau
  O(v1, 'porte', 190, -1);                // séjour → chambre 1
  O(v1, 'porte', 490, -1);                // séjour → WC
  O(v1, 'porte', 775, -1, 'end');         // entrée → chambre 2
  O(h2, 'porte', 125, 1);                 // chambre 2 → salle de bains

  // Meubles
  F('litDouble', 225, 170); F('chevet', 120, 100); F('chevet', 330, 100); F('armoire', 225, 340, 180);
  F('litDouble', 225, 790); F('armoire', 380, 640, 0);
  F('baignoire', 120, 440); F('lavabo', 170, 568, 180);
  F('wc', 350, 420); F('lavelinge', 400, 565);
  F('bureau', 1000, 700); F('armoire', 1130, 880, 180, 100);
  F('cuisine', 850, 48); F('frigo', 1140, 50); F('ilot', 850, 200);
  F('table', 700, 330); F('canape', 950, 470, 180); F('tableBasse', 950, 380, 0); F('meubleTV', 950, 230, 0); F('plante', 500, 560);
  F('plante', 480, 920);

  d.parcel = { pts: [{ x: -700, y: -500 }, { x: 1900, y: -500 }, { x: 1900, y: 1500 }, { x: -700, y: 1500 }] };
  d.roofs.push({ id: 'roof' + id++, cx: 600, cy: 475, length: 1230, width: 980, angle: 0, pitch: 35, overhang: 50, type: '4pans', eave: H, material: 'tuile' });
  d.section = { a: { x: -250, y: 300 }, b: { x: 1450, y: 300 }, label: 'A', flip: false };

  // Pièces nommées
  const names = [[225, 190, 'Chambre 1', 'parquet'], [125, 490, 'Salle de bains', 'carrelage'], [350, 490, 'WC / Buanderie', 'carrelage'], [225, 775, 'Chambre 2', 'parquet'],
    [825, 300, 'Séjour / Cuisine', 'carrelage'], [625, 775, 'Entrée', 'carrelage'], [1000, 775, 'Bureau', 'parquet']];
  const T = buildTopology(d.walls);
  for (const f of T.rooms) {
    const seed = interiorPoint(f.inner);
    const n = names.find((x) => pointInPoly({ x: x[0], y: x[1] }, f.center));
    d.rooms.push({ id: 'r' + id++, seed, name: n ? n[2] : 'Pièce', floor: n ? n[3] : 'parquet' });
  }
  d.nextId = id;
  return d;
}

import { FURNITURE as FURN } from './furniture.js';
