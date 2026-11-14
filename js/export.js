// Export PDF (dossier de plans) et PNG
import { store, stats, fmtLen, allFootprints, activeLevel, levelInfo } from './model.js';
import { drawPlan, planExtents, text, drawNorth, drawScaleBar, line } from './render2d.js';
import { drawFacadesGrid, facadesFitScale, drawSection, sectionExtents, heights } from './elev.js';
import { drawMasse, masseExtents } from './masse.js';
import { area } from './geom.js';

const PX = 6;              // pixels par mm
const U = PX * 0.3;        // unité de trait / texte
const A3 = { w: 420, h: 297 };
const MARGIN = 10, CART_W = 125, CART_H = 48;
const mm = (v) => v * PX;

function page() {
  const c = document.createElement('canvas');
  c.width = Math.round(mm(A3.w)); c.height = Math.round(mm(A3.h));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2 * U;
  ctx.strokeRect(mm(MARGIN), mm(MARGIN), mm(A3.w - 2 * MARGIN), mm(A3.h - 2 * MARGIN));
  return { c, ctx };
}

function cartouche(ctx, title, scaleLabel, pageNo, total) {
  const p = store.doc.project;
  const x = mm(A3.w - MARGIN - CART_W), y = mm(A3.h - MARGIN - CART_H), w = mm(CART_W), h = mm(CART_H);
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * U; ctx.strokeRect(x, y, w, h);
  const rows = [
    ['Projet', p.name || '—'], ['Maître d’ouvrage', p.owner || '—'], ['Adresse', p.address || '—'], ['Parcelle', p.parcelRef || '—'],
    ['Document', title], ['Échelle', scaleLabel], ['Date', p.date || ''], ['Page', `${pageNo} / ${total}`],
  ];
  const rh = h / rows.length;
  ctx.lineWidth = 0.6 * U;
  rows.forEach(([k, v], i) => {
    const ry = y + i * rh;
    if (i) line(ctx, { x, y: ry }, { x: x + w, y: ry });
    text(ctx, k, x + mm(2), ry + rh / 2, { size: 7.5, u: U, align: 'left', color: '#555' });
    text(ctx, v, x + mm(34), ry + rh / 2, { size: 8.5, u: U, align: 'left', bold: i === 0 || i === 4 });
  });
  line(ctx, { x: x + mm(32), y }, { x: x + mm(32), y: y + h });
  text(ctx, 'MymiHouseBoucletteBuilder', x + w - mm(2), y - mm(1.5), { size: 6.5, u: U, align: 'right', base: 'bottom', color: '#888' });
}

function titleBar(ctx, title, sub) {
  text(ctx, title, mm(MARGIN + 4), mm(MARGIN + 7), { size: 15, u: U, align: 'left', bold: true });
  if (sub) text(ctx, sub, mm(MARGIN + 4), mm(MARGIN + 14), { size: 9, u: U, align: 'left', color: '#444' });
}

const drawArea = () => ({ x: mm(MARGIN + 5), y: mm(MARGIN + 20), w: mm(A3.w - 2 * MARGIN - 10), h: mm(A3.h - 2 * MARGIN - 20 - CART_H - 6) });

function pickScale(wCm, hCm, areaPx, candidates) {
  for (const s of candidates) {
    const pxPerCm = (10 / s) * PX;
    if (wCm * pxPerCm <= areaPx.w && hCm * pxPerCm <= areaPx.h) return s;
  }
  return candidates[candidates.length - 1];
}

function pagePlan(no, total, levelIndex = store.doc.activeLevel) {
  const d0 = store.doc, prev = d0.activeLevel;
  d0.activeLevel = levelIndex;
  try { return pagePlanActive(no, total); } finally { d0.activeLevel = prev; }
}
function pagePlanActive(no, total) {
  const { c, ctx } = page();
  const lv = activeLevel(), multi = store.doc.levels.length > 1;
  const L = levelInfo()[store.doc.activeLevel];
  const ext = planExtents(false);
  const A = drawArea();
  const s = pickScale(ext.maxX - ext.minX, ext.maxY - ext.minY, { w: A.w - mm(60), h: A.h }, [50, 100, 200, 500]);
  const scale = (10 / s) * PX;
  const V = { scale, u: U, w: c.width, h: c.height, ox: A.x + mm(30) + (A.w - mm(60)) / 2 - ((ext.minX + ext.maxX) / 2) * scale, oy: A.y + A.h / 2 - ((ext.minY + ext.maxY) / 2) * scale };
  drawPlan(ctx, V, { print: true, noBg: true, parcel: false });
  titleBar(ctx, `Plan de niveau — ${lv.name}`, `${store.doc.project.note ? store.doc.project.note + ' — ' : ''}Échelle 1/${s} — cotes en ${store.doc.settings.dimUnit === 'cm' ? 'centimètres' : 'mètres'} — hauteur sous plafond ${(lv.height / 100).toFixed(2).replace('.', ',')} m${multi ? ` — sol fini à ${L.z0 >= 0 ? '+' : ''}${(L.z0 / 100).toFixed(2).replace('.', ',')} m` : ''}`);
  drawNorth(ctx, mm(A3.w - MARGIN - 18), mm(MARGIN + 22), mm(7), U);
  drawScaleBar(ctx, mm(MARGIN + 6), mm(A3.h - MARGIN - 12), scale, U, s >= 200 ? 10 : 5);
  // Tableau des surfaces
  const st = stats();
  const rows = st.rooms.map((r) => [r.room.name, (r.area / 1e4).toFixed(2).replace('.', ',') + ' m²']);
  rows.push([multi ? 'Surface habitable du niveau' : 'Surface habitable', st.habitable.toFixed(2).replace('.', ',') + ' m²']);
  rows.push(multi ? ['Surface habitable totale', st.habitableTotal.toFixed(2).replace('.', ',') + ' m²'] : ['Emprise au sol', st.emprise.toFixed(2).replace('.', ',') + ' m²']);
  const tx = mm(MARGIN + 6), ty = mm(A3.h - MARGIN - CART_H - 2) - rows.length * mm(5.2);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 0.7 * U;
  rows.forEach(([k, v], i) => {
    const y = ty + i * mm(5.2);
    const last = i >= rows.length - 2;
    ctx.fillStyle = last ? '#f0f0f0' : '#fff';
    ctx.fillRect(tx, y, mm(62), mm(5.2)); ctx.strokeRect(tx, y, mm(62), mm(5.2));
    text(ctx, k, tx + mm(1.5), y + mm(2.6), { size: 7.5, u: U, align: 'left', bold: last });
    text(ctx, v, tx + mm(60.5), y + mm(2.6), { size: 7.5, u: U, align: 'right', bold: last });
  });
  cartouche(ctx, `Plan ${lv.name}`, `1/${s}`, no, total);
  return c;
}

function pageMasse(no, total) {
  const { c, ctx } = page();
  const ext = masseExtents();
  const A = drawArea();
  const s = pickScale(ext.maxX - ext.minX, ext.maxY - ext.minY, { w: A.w, h: A.h }, [100, 200, 500, 1000]);
  const scale = (10 / s) * PX;
  const V = { scale, u: U, w: c.width, h: c.height, ox: A.x + A.w / 2 - ((ext.minX + ext.maxX) / 2) * scale, oy: A.y + A.h / 2 - ((ext.minY + ext.maxY) / 2) * scale };
  drawMasse(ctx, V);
  const st = stats();
  const d = store.doc;
  const parcelArea = d.parcel && d.parcel.pts.length > 2 ? area(d.parcel.pts) / 1e4 : 0;
  const { ridge, eave } = heights();
  const info = [`Emprise au sol : ${st.emprise.toFixed(2).replace('.', ',')} m²`, d.levels.length > 1 ? `Surface habitable : ${st.habitableTotal.toFixed(2).replace('.', ',')} m² sur ${d.levels.length} niveaux` : '', parcelArea ? `Surface parcelle : ${parcelArea.toFixed(0)} m²  —  CES ${((st.emprise / parcelArea) * 100).toFixed(1).replace('.', ',')} %` : '', `Hauteur à l’égout : ${(eave / 100).toFixed(2).replace('.', ',')} m  —  au faîtage : ${(ridge / 100).toFixed(2).replace('.', ',')} m`].filter(Boolean);
  titleBar(ctx, 'Plan de masse (PCMI2)', `Échelle 1/${s} — ${info.join('   |   ')}`);
  drawNorth(ctx, mm(A3.w - MARGIN - 18), mm(MARGIN + 22), mm(7), U);
  drawScaleBar(ctx, mm(MARGIN + 6), mm(A3.h - MARGIN - 12), scale, U, s >= 500 ? 20 : 10);
  cartouche(ctx, 'Plan de masse', `1/${s}`, no, total);
  return c;
}

function pageCoupe(no, total) {
  const { c, ctx } = page();
  const ext = sectionExtents();
  const A = drawArea();
  const s = pickScale(ext.maxX - ext.minX + 300, ext.maxZ - ext.minZ + 150, { w: A.w, h: A.h }, [50, 100, 200]);
  const scale = (10 / s) * PX;
  drawSection(ctx, A, scale, U, true);
  const lbl = store.doc.section.label || 'A';
  titleBar(ctx, `Plan en coupe ${lbl}-${lbl} (PCMI3)`, `Échelle 1/${s} — niveaux en mètres par rapport au sol fini (±0,00)`);
  cartouche(ctx, `Coupe ${lbl}-${lbl}`, `1/${s}`, no, total);
  return c;
}

function pageFacades(no, total) {
  const { c, ctx } = page();
  const fit = facadesFitScale();
  const A = drawArea();
  const s = pickScale(fit.maxW, fit.maxH, { w: A.w / 2, h: A.h / 2 }, [50, 100, 200]);
  const scale = (10 / s) * PX;
  ctx.save(); ctx.translate(A.x, A.y);
  drawFacadesGrid(ctx, A.w, A.h, U, scale);
  ctx.restore();
  titleBar(ctx, 'Façades (PCMI5)', `Échelle 1/${s}`);
  cartouche(ctx, 'Façades', `1/${s}`, no, total);
  return c;
}

function pagePerspective(img, no, total) {
  const { c, ctx } = page();
  const A = drawArea();
  const r = Math.min(A.w / img.width, A.h / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, A.x + (A.w - w) / 2, A.y + (A.h - h) / 2, w, h);
  titleBar(ctx, 'Document graphique — perspective (PCMI6)', 'Vue 3D indicative');
  cartouche(ctx, 'Perspective 3D', '—', no, total);
  return c;
}

function loadImg(url) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; }); }

export async function exportPDF({ snapshot = null, onProgress = () => {} } = {}) {
  const { jsPDF } = window.jspdf;
  const d = store.doc;
  const pages = [];
  if (d.parcel && d.parcel.pts.length > 2 && allFootprints().length) pages.push((n, t) => pageMasse(n, t));
  d.levels.forEach((lv, i) => { if (lv.walls.length) pages.push((n, t) => pagePlan(n, t, i)); });
  if (d.section && sectionExtents()) pages.push((n, t) => pageCoupe(n, t));
  if (facadesFitScale()) pages.push((n, t) => pageFacades(n, t));
  const img = snapshot ? await loadImg(snapshot) : null;
  if (img) pages.push((n, t) => pagePerspective(img, n, t));
  if (!pages.length) throw new Error('Rien à exporter : dessinez d’abord des murs.');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  for (let i = 0; i < pages.length; i++) {
    onProgress(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 10));
    const c = pages[i](i + 1, pages.length);
    if (i) pdf.addPage();
    pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, A3.w, A3.h);
  }
  const name = (d.project.name || 'projet').replace(/[^\w\dàâäéèêëïîôöùûüç' -]/gi, '_');
  pdf.save(`${name} - dossier plans.pdf`);
}

// Prévisualisation d'une page (débogage : ?page=plan|masse|coupe|facades)
export function renderPage(name) {
  const fn = { plan: pagePlan, masse: pageMasse, coupe: pageCoupe, facades: pageFacades }[name];
  return fn ? fn(1, 1) : null;
}

export function exportPNG() {
  const c = pagePlan(1, 1);
  const a = document.createElement('a');
  a.download = `${store.doc.project.name || 'plan'}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}
