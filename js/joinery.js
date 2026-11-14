// Menuiseries (matériau, couleur, ouvrants, imposte, petits bois) et parements extérieurs
import { store } from './model.js';
import { OPENING_TYPES } from './walls.js';

export const JOINERY_MATERIALS = { pvc: 'PVC', alu: 'Aluminium', bois: 'Bois' };
export const JOINERY_COLORS = [
  { c: '#f4f4f2', n: 'Blanc' },
  { c: '#e9e4d6', n: 'Crème' },
  { c: '#a7aaa8', n: 'Gris clair' },
  { c: '#383e42', n: 'Gris anthracite (RAL 7016)' },
  { c: '#1e1e1e', n: 'Noir' },
  { c: '#b07a42', n: 'Chêne doré' },
  { c: '#6b4a2f', n: 'Noyer' },
  { c: '#56634b', n: 'Vert olive' },
  { c: '#3b5573', n: 'Bleu' },
  { c: '#8c2f2a', n: 'Rouge basque' },
];

// Parements extérieurs. size = côté (cm) couvert par une répétition de la texture
export const FINISHES = {
  enduit: { label: 'Enduit', size: 100, colors: [['#efe9dc', 'Blanc cassé'], ['#e6d8bd', 'Ton pierre'], ['#d9c39a', 'Sable'], ['#d2a467', 'Ocre'], ['#e3c1b0', 'Rosé'], ['#c9c9c4', 'Gris clair'], ['#5b5f62', 'Gris anthracite']] },
  bardageH: { label: 'Bardage bois horizontal', size: 120, colors: [['#b8875a', 'Bois naturel'], ['#9a948a', 'Bois grisé'], ['#8a5a36', 'Brun'], ['#4a4f53', 'Gris anthracite'], ['#2b2b2b', 'Noir'], ['#ece9e2', 'Blanc']] },
  bardageV: { label: 'Bardage bois vertical', size: 120, colors: [['#b8875a', 'Bois naturel'], ['#9a948a', 'Bois grisé'], ['#8a5a36', 'Brun'], ['#4a4f53', 'Gris anthracite'], ['#2b2b2b', 'Noir'], ['#ece9e2', 'Blanc']] },
  pierre: { label: 'Placage pierre (moellons)', size: 150, colors: [['#d8ccb4', 'Pierre claire'], ['#c9a979', 'Pierre ocre'], ['#a9a7a0', 'Pierre grise']] },
  pierreTaille: { label: 'Pierre de taille (blocs)', size: 150, colors: [['#e1d6bf', 'Calcaire clair'], ['#cdb894', 'Pierre dorée'], ['#a9a7a0', 'Pierre grise']] },
  brique: { label: 'Brique', size: 92, colors: [['#a5513a', 'Brique rouge'], ['#c98e66', 'Brique claire'], ['#6d5b52', 'Brique sombre']] },
};

const KINDS_GLAZED = ['window', 'french', 'slider'];

// Valeurs effectives d'une ouverture (les anciens fichiers n'ont pas ces champs)
export function joinery(o) {
  const s = store.doc.settings;
  const def = OPENING_TYPES[o.type] || OPENING_TYPES.fenetre;
  const kind = def.kind;
  let leaves = o.leaves;
  if (leaves == null) leaves = kind === 'slider' ? 2 : kind === 'french' ? (o.width >= 100 ? 2 : 1) : kind === 'window' ? (o.width >= 90 ? 2 : 1) : 1;
  return {
    kind,
    glazed: KINDS_GLAZED.includes(kind),
    material: o.material || s.joineryMaterial || 'pvc',
    color: o.color || (kind === 'door' && o.type === 'porte' ? '#f1efe9' : kind === 'garage' ? s.joineryColor || '#f4f4f2' : s.joineryColor || '#f4f4f2'),
    leaves,
    transom: Math.max(0, o.transom || 0),   // imposte fixe en haut (cm)
    lower: Math.max(0, o.lower || 0),       // partie fixe basse (cm)
    barsX: Math.max(0, Math.round(o.barsX || 0)), // petits bois : montants par vantail
    barsY: Math.max(0, Math.round(o.barsY || 0)), // petits bois : traverses par vantail
  };
}

// Découpe d'une menuiserie vitrée, en coordonnées locales : x de 0 à w (gauche→droite vu de l'extérieur), z de 0 à h (bas→haut)
// Retourne les vitrages (rectangles) — tout le reste est du cadre — et les petits bois.
export function joineryLayout(o, w, h) {
  const J = joinery(o);
  const F = J.material === 'alu' ? 5 : 7;          // dormant
  const S = J.material === 'alu' ? 4.5 : 6;        // ouvrant
  const T = J.material === 'alu' ? 5 : 7;          // traverse / meneau
  const glass = [], bars = [], leaves = [];
  if (!J.glazed || w < 2 * F + 10 || h < 2 * F + 10) return { J, glass, bars, leaves, F };
  const x0 = F, x1 = w - F;
  let zLo = F, zHi = h - F;
  // imposte et partie basse fixes
  const tr = Math.min(J.transom, (zHi - zLo) * 0.45), lo = Math.min(J.lower, (zHi - zLo) * 0.45);
  if (tr > 10) { glass.push({ x0, x1, z0: zHi - tr + T / 2, z1: zHi, fixed: true }); zHi -= tr + T / 2; }
  if (lo > 10) { glass.push({ x0, x1, z0: zLo, z1: zLo + lo - T / 2, fixed: true }); zLo += lo + T / 2; }
  const n = Math.max(1, J.leaves || 1);
  const fixed = J.leaves === 0;
  const cw = (x1 - x0 - (n - 1) * T) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * (cw + T), b = a + cw;
    const inset = fixed ? 0 : S;
    const pane = { x0: a + inset, x1: b - inset, z0: zLo + inset, z1: zHi - inset, leaf: i, fixed };
    if (pane.x1 - pane.x0 < 4 || pane.z1 - pane.z0 < 4) continue;
    glass.push(pane);
    // charnières : vantail de gauche à gauche, de droite à droite (ouvrant à la française)
    leaves.push({ x0: a, x1: b, z0: zLo, z1: zHi, hinge: J.kind === 'slider' ? null : n === 1 ? (o.hinge === 'end' ? 'right' : 'left') : i < n / 2 ? 'left' : 'right', fixed, slider: J.kind === 'slider' });
    for (let k = 1; k <= J.barsX; k++) { const x = pane.x0 + ((pane.x1 - pane.x0) * k) / (J.barsX + 1); bars.push({ x0: x, z0: pane.z0, x1: x, z1: pane.z1 }); }
    for (let k = 1; k <= J.barsY; k++) { const z = pane.z0 + ((pane.z1 - pane.z0) * k) / (J.barsY + 1); bars.push({ x0: pane.x0, z0: z, x1: pane.x1, z1: z }); }
  }
  return { J, glass, bars, leaves, F };
}

// Parement effectif d'un mur extérieur
export function wallFinish(w) {
  const s = store.doc.settings;
  const type = FINISHES[w.finish] ? w.finish : FINISHES[s.facadeFinish] ? s.facadeFinish : 'enduit';
  const color = w.finish ? w.finishColor || FINISHES[type].colors[0][0] : s.facadeColor || FINISHES[type].colors[0][0];
  return { type, color, def: FINISHES[type] };
}

// ---------- Couleurs ----------
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- Textures dessinées (canvas), une par parement + couleur ----------
const texCache = new Map();
export function finishCanvas(type, color) {
  if (typeof document === 'undefined') return null;
  const key = type + color;
  if (texCache.has(key)) return texCache.get(key);
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const def = FINISHES[type];
  const px = N / def.size; // pixels par cm
  const R = rng(type.length * 7919 + parseInt(color.slice(1), 16));
  g.fillStyle = color; g.fillRect(0, 0, N, N);
  if (type === 'enduit') {
    for (let i = 0; i < 9000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)'; const r = 0.6 + R() * 1.6; g.fillRect(R() * N, R() * N, r, r); }
  } else if (type === 'bardageH' || type === 'bardageV') {
    const plank = 15 * px; // lames de 15 cm
    for (let y = 0, i = 0; y < N; y += plank, i++) {
      g.fillStyle = shade(color, (R() - 0.5) * 0.16); g.fillRect(0, y, N, plank);
      for (let k = 0; k < 7; k++) { g.strokeStyle = `rgba(0,0,0,${0.04 + R() * 0.05})`; g.lineWidth = 0.6 + R(); g.beginPath(); const yy = y + R() * plank; g.moveTo(0, yy); g.bezierCurveTo(N * 0.3, yy + (R() - 0.5) * 4, N * 0.7, yy + (R() - 0.5) * 4, N, yy + (R() - 0.5) * 3); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, y, N, 1.5);
      g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, y + plank - 2.5, N, 2.5);
      // aboutages
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(((i * 0.37) % 1) * N, y, 1.5, plank);
    }
    if (type === 'bardageV') {
      const c2 = document.createElement('canvas'); c2.width = c2.height = N;
      const g2 = c2.getContext('2d'); g2.translate(N, 0); g2.rotate(Math.PI / 2); g2.drawImage(c, 0, 0);
      texCache.set(key, c2); return c2;
    }
  } else if (type === 'pierre') {
    g.fillStyle = shade(color, 0.25); g.fillRect(0, 0, N, N); // mortier
    let y = 0;
    while (y < N) {
      const rh = (14 + R() * 14) * px;
      const hgt = Math.min(rh, N - y);
      let x = -R() * 30 * px;
      while (x < N) {
        const sw = (20 + R() * 32) * px;
        g.fillStyle = shade(color, (R() - 0.5) * 0.35);
        const j = 1.3 * px, rr = 3 * px;
        roundRect(g, x + j, y + j, sw - 2 * j, hgt - 2 * j, rr); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(g, x + j, y + j, sw - 2 * j, (hgt - 2 * j) * 0.35, rr); g.fill();
        x += sw;
      }
      y += rh;
    }
    wrapEdges(g, c, N);
  } else if (type === 'pierreTaille') {
    g.fillStyle = shade(color, 0.2); g.fillRect(0, 0, N, N);
    const bh = 30 * px, bw = 50 * px, j = 0.8 * px;
    for (let r = 0, y = 0; y < N; r++, y += bh) for (let x = (r % 2) * -bw / 2; x < N; x += bw) {
      g.fillStyle = shade(color, (R() - 0.5) * 0.14); g.fillRect(x + j, y + j, bw - 2 * j, bh - 2 * j);
      for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x + R() * bw, y + R() * bh, 2, 2); }
    }
  } else if (type === 'brique') {
    g.fillStyle = '#cfc8bb'; g.fillRect(0, 0, N, N);
    const bh = 7.5 * px, bw = 23 * px, j = 1 * px;
    for (let r = 0, y = 0; y < N; r++, y += bh) for (let x = (r % 2) * -bw / 2; x < N; x += bw) { g.fillStyle = shade(color, (R() - 0.5) * 0.3); g.fillRect(x + j / 2, y + j / 2, bw - j, bh - j); }
  }
  texCache.set(key, c);
  return c;
}
function roundRect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// Raccord des bords pour une répétition sans couture (moellons)
function wrapEdges(g, c, N) {
  const t = document.createElement('canvas'); t.width = t.height = N;
  t.getContext('2d').drawImage(c, 0, 0);
  g.drawImage(t, 0, N - 2, N, 2, 0, 0, N, 2);
  g.drawImage(t, N - 2, 0, 2, N, 0, 0, 2, N);
}

// ---------- Motifs vectoriels pour les façades 2D (rectangle X0..X1 / Z0..Z1 en cm, SX/SZ vers l'écran) ----------
export function drawFinishPattern(ctx, type, color, box, SX, SZ, u) {
  const { X0, X1, Z0, Z1 } = box;
  const L = (xa, za, xb, zb) => { ctx.beginPath(); ctx.moveTo(SX(xa), SZ(za)); ctx.lineTo(SX(xb), SZ(zb)); ctx.stroke(); };
  ctx.strokeStyle = shade(color, -0.45); ctx.lineWidth = 0.35 * u;
  if (type === 'bardageH') for (let z = Math.ceil(Z0 / 15) * 15; z < Z1; z += 15) L(X0, z, X1, z);
  else if (type === 'bardageV') for (let x = Math.ceil(X0 / 15) * 15; x < X1; x += 15) L(x, Z0, x, Z1);
  else if (type === 'brique') { ctx.lineWidth = 0.25 * u; ctx.strokeStyle = shade(color, 0.35); for (let z = Math.ceil(Z0 / 7.5) * 7.5; z < Z1; z += 7.5) L(X0, z, X1, z); }
  else if (type === 'pierreTaille') {
    for (let z = Math.ceil(Z0 / 30) * 30, r = 0; z < Z1 + 30; z += 30, r++) {
      if (z < Z1) L(X0, z, X1, z);
      const off = (Math.round(z / 30) % 2) * 25;
      for (let x = Math.ceil((X0 - off) / 50) * 50 + off; x < X1; x += 50) L(x, Math.max(Z0, z - 30), x, Math.min(Z1, z));
    }
  } else if (type === 'pierre') {
    let z = Z0, row = 0;
    while (z < Z1) {
      const R = rng(row * 131 + 7);
      const rh = 16 + R() * 12, zt = Math.min(Z1, z + rh);
      if (zt < Z1) L(X0, zt, X1, zt);
      let x = Math.floor(X0 / 200) * 200 - R() * 30;
      while (x < X1) { const sw = 22 + R() * 30; x += sw; if (x > X0 && x < X1) L(x, z, x, zt); }
      z = zt; row++;
    }
  }
}
