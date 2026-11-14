// Bibliothèque de mobilier : symbole 2D (repère local centré, cm) + volumes 3D simples
// parts(w,d,h) -> [x, y, z, sx, sy, sz, couleur]  (x,y = centre local ; z = bas)

const R = (ctx, x, y, w, h) => ctx.rect(x, y, w, h);
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
const ell = (ctx, x, y, rx, ry) => { ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };

const WOOD = '#b98a5e', WHITE = '#f4f4f2', FABRIC = '#7d8fa3', DARK = '#555', STEEL = '#c9ccd1', SHEET = '#e8e2d6';

export const FURNITURE = {
  litDouble: {
    label: 'Lit double', cat: 'Chambre', w: 160, d: 200, h: 50,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); rr(c, -w / 2 + 8, -d / 2 + 8, w / 2 - 12, 30, 6); rr(c, 4, -d / 2 + 8, w / 2 - 12, 30, 6); c.moveTo(-w / 2, -d / 2 + 50); c.lineTo(w / 2, -d / 2 + 50); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h - 15, WOOD], [0, 4, h - 15, w - 4, d - 12, 15, SHEET], [0, -d / 2 + 3, 0, w, 6, 95, WOOD], [-w / 4, -d / 2 + 25, h, w / 2 - 14, 30, 10, WHITE], [w / 4, -d / 2 + 25, h, w / 2 - 14, 30, 10, WHITE]],
  },
  litSimple: {
    label: 'Lit simple', cat: 'Chambre', w: 90, d: 190, h: 50,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); rr(c, -w / 2 + 8, -d / 2 + 8, w - 16, 28, 6); c.moveTo(-w / 2, -d / 2 + 48); c.lineTo(w / 2, -d / 2 + 48); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h - 15, WOOD], [0, 4, h - 15, w - 4, d - 12, 15, SHEET], [0, -d / 2 + 3, 0, w, 6, 90, WOOD], [0, -d / 2 + 24, h, w - 16, 28, 10, WHITE]],
  },
  chevet: {
    label: 'Table de chevet', cat: 'Chambre', w: 45, d: 40, h: 50,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, WOOD]],
  },
  armoire: {
    label: 'Armoire / placard', cat: 'Chambre', w: 120, d: 60, h: 220,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, d / 2); c.moveTo(w / 2, -d / 2); c.lineTo(-w / 2, d / 2); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, '#d8cbb8']],
  },
  bureau: {
    label: 'Bureau', cat: 'Bureau', w: 140, d: 70, h: 75,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); rr(c, -22, d / 2 + 5, 44, 40, 8); },
    parts: (w, d, h) => [[0, 0, h - 4, w, d, 4, WOOD], [-w / 2 + 3, 0, 0, 4, d - 6, h - 4, DARK], [w / 2 - 3, 0, 0, 4, d - 6, h - 4, DARK], [0, d / 2 + 25, 0, 44, 44, 45, DARK], [0, d / 2 + 45, 45, 44, 6, 45, DARK]],
  },
  canape: {
    label: 'Canapé 3 places', cat: 'Séjour', w: 220, d: 90, h: 85,
    draw(c, w, d) { rr(c, -w / 2, -d / 2, w, d, 8); c.rect(-w / 2 + 18, -d / 2, w - 36, 22); c.rect(-w / 2, -d / 2, 18, d); c.rect(w / 2 - 18, -d / 2, 18, d); c.moveTo(-w / 6 + 6, -d / 2 + 22); c.lineTo(-w / 6 + 6, d / 2); c.moveTo(w / 6 - 6, -d / 2 + 22); c.lineTo(w / 6 - 6, d / 2); },
    parts: (w, d, h) => [[0, 4, 0, w - 36, d - 8, 42, FABRIC], [0, -d / 2 + 11, 0, w, 22, h, FABRIC], [-w / 2 + 9, 0, 0, 18, d, 60, FABRIC], [w / 2 - 9, 0, 0, 18, d, 60, FABRIC]],
  },
  fauteuil: {
    label: 'Fauteuil', cat: 'Séjour', w: 85, d: 85, h: 85,
    draw(c, w, d) { rr(c, -w / 2, -d / 2, w, d, 8); c.rect(-w / 2 + 15, -d / 2, w - 30, 20); c.rect(-w / 2, -d / 2, 15, d); c.rect(w / 2 - 15, -d / 2, 15, d); },
    parts: (w, d, h) => [[0, 4, 0, w - 30, d - 8, 42, FABRIC], [0, -d / 2 + 10, 0, w, 20, h, FABRIC], [-w / 2 + 7, 0, 0, 15, d, 60, FABRIC], [w / 2 - 7, 0, 0, 15, d, 60, FABRIC]],
  },
  tableBasse: {
    label: 'Table basse', cat: 'Séjour', w: 110, d: 60, h: 40,
    draw(c, w, d) { rr(c, -w / 2, -d / 2, w, d, 4); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, WOOD]],
  },
  meubleTV: {
    label: 'Meuble TV', cat: 'Séjour', w: 180, d: 45, h: 50,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); c.moveTo(-w / 2 + 30, d / 2 - 6); c.lineTo(w / 2 - 30, d / 2 - 6); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, '#6b5a4a'], [0, 0, h, w - 60, 8, 70, '#222']],
  },
  table: {
    label: 'Table + 6 chaises', cat: 'Séjour', w: 180, d: 90, h: 75,
    draw(c, w, d) {
      R(c, -w / 2, -d / 2, w, d);
      for (const x of [-w / 3, 0, w / 3]) { rr(c, x - 21, -d / 2 - 45, 42, 40, 6); rr(c, x - 21, d / 2 + 5, 42, 40, 6); }
    },
    parts: (w, d, h) => {
      const p = [[0, 0, h - 5, w, d, 5, WOOD]];
      for (const [x, y] of [[-w / 2 + 6, -d / 2 + 6], [w / 2 - 6, -d / 2 + 6], [-w / 2 + 6, d / 2 - 6], [w / 2 - 6, d / 2 - 6]]) p.push([x, y, 0, 6, 6, h - 5, WOOD]);
      for (const x of [-w / 3, 0, w / 3]) for (const s of [-1, 1]) { p.push([x, s * (d / 2 + 25), 0, 42, 40, 46, DARK]); p.push([x, s * (d / 2 + 43), 46, 42, 4, 44, DARK]); }
      return p;
    },
  },
  cuisine: {
    label: 'Cuisine linéaire', cat: 'Cuisine', w: 300, d: 62, h: 90,
    draw(c, w, d) {
      R(c, -w / 2, -d / 2, w, d);
      rr(c, -40, -d / 2 + 10, 50, 40, 6); rr(c, 14, -d / 2 + 10, 34, 40, 6);
      for (const [x, y] of [[w / 2 - 75, -8], [w / 2 - 45, -8], [w / 2 - 75, 18], [w / 2 - 45, 18]]) ell(c, x, y, 10, 10);
    },
    parts: (w, d, h) => [[0, 0, 0, w, d, h - 4, WHITE], [0, 0, h - 4, w, d, 4, '#3c3c3c'], [0, -d / 2 + 18, 150, w, 35, 70, WHITE]],
  },
  ilot: {
    label: 'Îlot central', cat: 'Cuisine', w: 200, d: 100, h: 90,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); c.moveTo(-w / 2, -d / 2 + 65); c.lineTo(w / 2, -d / 2 + 65); },
    parts: (w, d, h) => [[0, 0, 0, w, d - 30, h - 4, WHITE], [0, 0, h - 4, w, d, 4, '#3c3c3c']],
  },
  frigo: {
    label: 'Réfrigérateur', cat: 'Cuisine', w: 70, d: 65, h: 185,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); c.moveTo(-w / 2, d / 2 - 8); c.lineTo(w / 2, d / 2 - 8); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, STEEL]],
  },
  baignoire: {
    label: 'Baignoire', cat: 'Salle de bains', w: 170, d: 75, h: 58,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); rr(c, -w / 2 + 8, -d / 2 + 8, w - 16, d - 16, 28); ell(c, w / 2 - 28, 0, 3, 3); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, WHITE]],
  },
  douche: {
    label: 'Douche', cat: 'Salle de bains', w: 90, d: 90, h: 5,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, d / 2); c.moveTo(w / 2, -d / 2); c.lineTo(-w / 2, d / 2); ell(c, 0, 0, 4, 4); },
    parts: (w, d, h) => [[0, 0, 0, w, d, 5, WHITE], [0, d / 2 - 1, 5, w, 1, 195, '#cfe3ee']],
  },
  lavabo: {
    label: 'Lavabo / vasque', cat: 'Salle de bains', w: 80, d: 50, h: 85,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); ell(c, 0, 4, w / 2 - 14, d / 2 - 12); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, '#d9d2c5'], [0, -d / 2 + 2, h + 20, w - 10, 2, 70, '#cfe3ee']],
  },
  wc: {
    label: 'WC', cat: 'Salle de bains', w: 38, d: 65, h: 40,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, 18); ell(c, 0, d / 2 - 24, w / 2 - 2, 24); },
    parts: (w, d, h) => [[0, -d / 2 + 9, 0, w, 18, 80, WHITE], [0, 8, 0, w - 4, d - 22, h, WHITE]],
  },
  lavelinge: {
    label: 'Lave-linge', cat: 'Salle de bains', w: 60, d: 60, h: 85,
    draw(c, w, d) { R(c, -w / 2, -d / 2, w, d); ell(c, 0, 4, 18, 18); },
    parts: (w, d, h) => [[0, 0, 0, w, d, h, WHITE]],
  },
  voiture: {
    label: 'Voiture', cat: 'Extérieur', w: 180, d: 440, h: 145,
    draw(c, w, d) { rr(c, -w / 2, -d / 2, w, d, 40); rr(c, -w / 2 + 15, -d / 2 + 110, w - 30, 70, 14); rr(c, -w / 2 + 15, d / 2 - 140, w - 30, 60, 14); },
    parts: (w, d, h) => [[0, 0, 15, w, d, 65, '#5a6f86'], [0, 15, 80, w - 20, d * 0.5, h - 80, '#4a5d72']],
  },
  arbre: {
    label: 'Arbre', cat: 'Extérieur', w: 300, d: 300, h: 500,
    draw(c, w, d) { ell(c, 0, 0, w / 2, d / 2); ell(c, 0, 0, 8, 8); },
    parts: (w, d, h) => [[0, 0, 0, 25, 25, h * 0.45, '#7a5a3a'], [0, 0, h * 0.4, w * 0.8, d * 0.8, h * 0.6, '#5f8f4e']],
  },
  plante: {
    label: 'Plante', cat: 'Séjour', w: 45, d: 45, h: 110,
    draw(c, w, d) { ell(c, 0, 0, w / 2, d / 2); ell(c, 0, 0, w / 5, d / 5); },
    parts: (w, d, h) => [[0, 0, 0, 30, 30, 35, '#9a7b5b'], [0, 0, 35, w, d, h - 35, '#5f8f4e']],
  },
};

export const FURNITURE_CATS = [...new Set(Object.values(FURNITURE).map((f) => f.cat))];
