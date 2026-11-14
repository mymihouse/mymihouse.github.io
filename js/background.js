// Fond de plan : import PDF / image, affichage sous le dessin, mise à l'échelle
const MAX_PX = 2600;

function toJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.82); }

async function pdfToImage(file, askPage) {
  if (location.search.includes('noworker')) globalThis.Worker = undefined; // tests automatisés : rendu sur le fil principal
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let pageNo = 1;
  if (pdf.numPages > 1) pageNo = Math.max(1, Math.min(pdf.numPages, askPage(pdf.numPages)));
  const page = await pdf.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_PX / v1.width, MAX_PX / v1.height, 6);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { src: toJpeg(c), w: c.width, h: c.height, pages: pdf.numPages, page: pageNo };
}

function fileToImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_PX / img.width, MAX_PX / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res({ src: toJpeg(c), w: c.width, h: c.height, pages: 1, page: 1 });
    };
    img.onerror = () => rej(new Error('image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

export async function importBackground(file, askPage) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? pdfToImage(file, askPage) : fileToImage(file);
}

// Cache des images décodées
const cache = new Map();
let onLoaded = null;
export function setBackgroundLoadedCallback(fn) { onLoaded = fn; }
export function getImage(src) {
  let e = cache.get(src);
  if (e) return e.ready ? e.img : null;
  const img = new Image();
  e = { img, ready: false };
  cache.set(src, e);
  img.onload = () => { e.ready = true; onLoaded?.(); };
  img.src = src;
  return null;
}

// Rectangle du fond en coordonnées plan (4 coins, rotation incluse)
export function backgroundCorners(bg) {
  const w = bg.w * bg.scale, h = bg.h * bg.scale;
  const cx = bg.x + w / 2, cy = bg.y + h / 2;
  const a = ((bg.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

export function drawBackground(ctx, S, V, bg, selected) {
  const img = getImage(bg.src);
  const w = bg.w * bg.scale * V.scale, h = bg.h * bg.scale * V.scale;
  const c = S({ x: bg.x + (bg.w * bg.scale) / 2, y: bg.y + (bg.h * bg.scale) / 2 });
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(((bg.rot || 0) * Math.PI) / 180);
  if (img) { ctx.globalAlpha = bg.opacity ?? 0.5; ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.globalAlpha = 1; }
  else { ctx.fillStyle = '#f3f3f3'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  if (selected || !bg.locked) {
    ctx.strokeStyle = selected ? '#1a73e8' : 'rgba(26,115,232,.45)'; ctx.lineWidth = selected ? 2 : 1; ctx.setLineDash([8, 5]);
    ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
  }
  ctx.restore();
}
