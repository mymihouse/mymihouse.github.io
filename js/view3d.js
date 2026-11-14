// Vue 3D (orbite) et visite à pied
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { store, levelInfo, levelData, isVoidRoom } from './model.js';
import { wallPieces, OPENING_TYPES, openingRange, pointOnWall, isPassable } from './walls.js';
import { roofGeometry } from './roof.js';
import { FURNITURE } from './furniture.js';
import { joinery, joineryLayout, wallFinish, finishCanvas, FINISHES } from './joinery.js';
import { pointInPoly, add, mul, distToPolyEdges, bbox } from './geom.js';

const FLOOR3D = { parquet: '#c49a6c', carrelage: '#d8d6d0', beton: '#bdbbb6', moquette: '#9c8fa6' };
const C_EXT = new THREE.Color('#efe4cf'), C_INT = new THREE.Color('#f6f4f0'), C_TOP = new THREE.Color('#a9a59c');

let renderer, scene, camera, orbit, walk, container, group, built = -1, active = false;
let showRoof = true;
let cutaway = false;       // true : n'affiche que jusqu'au niveau actif (pour voir dedans)
const keys = {};
let collide = [];
let collideBy = [];
let walkY = 160;

export function init3D(el) {
  container = el;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f3');
  scene.fog = new THREE.Fog('#cfe3f3', 8000, 30000);
  camera = new THREE.PerspectiveCamera(50, 1, 5, 100000);
  camera.position.set(1500, 1500, 2000);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.495;
  walk = new PointerLockControls(camera, renderer.domElement);
  walk.addEventListener('unlock', () => { orbit.enabled = true; el.dispatchEvent(new CustomEvent('walkend')); });
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f7a', 1.6));
  const sun = new THREE.DirectionalLight('#fff6e5', 2.2);
  sun.position.set(-2500, 4000, 3000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3000, right: 3000, top: 3000, bottom: -3000, near: 100, far: 15000 });
  sun.shadow.bias = -0.0005;
  scene.add(sun); scene.add(sun.target);
  scene.userData.sun = sun;
  group = new THREE.Group();
  scene.add(group);
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  new ResizeObserver(resize).observe(el);
  let last = performance.now();
  const loop = (t) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!active) return;
    if (walk.isLocked) stepWalk(dt); else orbit.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
}

function resize() {
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function setActive(on) {
  active = on;
  if (on) { resize(); if (built !== store.geomVersion) { rebuild(!framed); framed = true; } }
}
export function markDirty() { if (active) rebuild(false); }
export function toggleRoof() { showRoof = !showRoof; rebuild(false); return showRoof; }
export function toggleCutaway() { cutaway = !cutaway; rebuild(false); return cutaway; }
export const isCutaway = () => cutaway;

// Textures de parement (une par type + couleur)
const texMats = new Map();
function finishMaterial(type, color) {
  const key = type + color;
  if (texMats.has(key)) return texMats.get(key);
  const cv = finishCanvas(type, color);
  let m;
  if (cv) {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    m = new THREE.MeshStandardMaterial({ map: t, roughness: type.startsWith('bardage') ? 0.75 : 0.92, side: THREE.DoubleSide });
  } else m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
  m.userData.size = FINISHES[type]?.size || 100;
  texMats.set(key, m);
  return m;
}
const colMats = new Map();
function colorMat(color, rough = 0.5, metal = 0) {
  const key = color + rough + metal;
  if (!colMats.has(key)) colMats.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return colMats.get(key);
}
// Peau texturée posée sur la face extérieure d'un tronçon de mur (coordonnées de texture en cm)
function skinQuad(p0, p1, za, zb, n, g, size, material) {
  const o = 0.4;
  const A = add(p0, mul(n, o)), B = add(p1, mul(n, o));
  const u0 = ((p0.x - g.a.x) * g.d.x + (p0.y - g.a.y) * g.d.y) / size, u1 = ((p1.x - g.a.x) * g.d.x + (p1.y - g.a.y) * g.d.y) / size;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([A.x, za, A.y, B.x, za, B.y, B.x, zb, B.y, A.x, za, A.y, B.x, zb, B.y, A.x, zb, A.y], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([u0, za / size, u1, za / size, u1, zb / size, u0, za / size, u1, zb / size, u0, zb / size], 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  return m;
}
// Menuiserie vitrée : cadre percé des vitrages, vitres, petits bois. Repère local : X le long du mur, Y vers le haut, Z = normale du mur
function joineryMesh(o, ow, h) {
  const grp = new THREE.Group();
  const { J, glass, bars } = joineryLayout(o, ow, h);
  const metal = J.material === 'alu' ? 0.35 : 0;
  const frameM = colorMat(J.color, J.material === 'bois' ? 0.7 : 0.45, metal);
  const sh = new THREE.Shape([new THREE.Vector2(-ow / 2, 0), new THREE.Vector2(ow / 2, 0), new THREE.Vector2(ow / 2, h), new THREE.Vector2(-ow / 2, h)]);
  for (const r of glass) sh.holes.push(new THREE.Path([new THREE.Vector2(r.x0 - ow / 2, r.z0), new THREE.Vector2(r.x0 - ow / 2, r.z1), new THREE.Vector2(r.x1 - ow / 2, r.z1), new THREE.Vector2(r.x1 - ow / 2, r.z0)]));
  const D = 7;
  const fg = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false });
  fg.translate(0, 0, -D / 2);
  const fm = new THREE.Mesh(fg, frameM); fm.castShadow = true; fm.receiveShadow = true;
  grp.add(fm);
  for (const r of glass) {
    const gm = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, r.z1 - r.z0, 1), GLASS);
    gm.position.set((r.x0 + r.x1) / 2 - ow / 2, (r.z0 + r.z1) / 2, 0);
    grp.add(gm);
  }
  for (const b of bars) {
    const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), vert = Math.abs(b.x1 - b.x0) < 0.01;
    const bm = new THREE.Mesh(new THREE.BoxGeometry(vert ? 2.5 : len, vert ? len : 2.5, 3), frameM);
    bm.position.set((b.x0 + b.x1) / 2 - ow / 2, (b.z0 + b.z1) / 2, 0);
    grp.add(bm);
  }
  return grp;
}
let GLASS = null;

function mat(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); }

function extrudePoly(poly, z0, z1) {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.5, z1 - z0), bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, z0, 0);
  return geo;
}

function box(x, y, z, sx, sy, sz, color, rotY = 0, m = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sz, sy), m || mat(color));
  mesh.position.set(x, z + sz / 2, y);
  mesh.rotation.y = rotY;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function polyMesh(pts3, material) {
  const pos = [];
  for (let i = 1; i < pts3.length - 1; i++) for (const p of [pts3[0], pts3[i], pts3[i + 1]]) pos.push(p.x, p.z, p.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (material.map) { // pignon texturé : projection plane, 1 unité = taille du motif
    const size = material.userData.size || 100, uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + pos[i + 2]) / size, pos[i + 1] / size);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function rebuild(frame) {
  built = store.geomVersion;
  for (const c of [...group.children]) { group.remove(c); c.traverse?.((o) => { o.geometry?.dispose(); }); }
  const d = store.doc;
  const fa = d.settings.floorAboveGround, slabT = d.settings.slabThickness || 20;
  const info = levelInfo();
  const maxShown = cutaway ? d.activeLevel : info.length - 1;
  const roofsOn = showRoof && !cutaway;
  const shape = (poly) => new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.y)));
  collideBy = info.map(() => []);

  // Sol / terrain
  const allFp = info.flatMap((L) => levelData(L.level).topo.footprints.map((f) => f.outer));
  const pts = [...allFp.flat(), ...(d.parcel?.pts || [])];
  const bb = pts.length ? bbox(pts) : { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), mat('#9cb486'));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -fa - 1, cy); ground.receiveShadow = true;
  group.add(ground);
  if (d.parcel && d.parcel.pts.length > 2) {
    const pm = new THREE.Mesh(new THREE.ShapeGeometry(shape(d.parcel.pts)), mat('#86ad6c'));
    pm.rotation.x = -Math.PI / 2; pm.position.y = -fa - 0.5; pm.receiveShadow = true;
    group.add(pm);
  }

  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  if (!GLASS) GLASS = new THREE.MeshStandardMaterial({ color: '#9fc4dc', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 });
  let topZ = 0;

  for (const L of info) {
    if (L.index > maxShown) break;
    const lv = L.level, z0 = L.z0;
    const { geoms: G, topo: T, rooms } = levelData(lv);
    const fps = T.footprints.map((f) => f.outer);
    const inside = (x, y) => fps.some((p) => pointInPoly({ x, y }, p));
    const live = rooms.filter((r) => r.inner && !r.dup);
    const voids = L.index > 0 ? live.filter((r) => isVoidRoom(r.room.name)) : [];
    topZ = Math.max(topZ, L.top);

    // Dalle du rez-de-chaussée ou plancher d'étage (percé par les trémies)
    for (const p of fps) {
      const sh = shape(p);
      for (const v of voids) if (pointInPoly(v.room.seed, p)) sh.holes.push(new THREE.Path(v.inner.map((q) => new THREE.Vector2(q.x, -q.y))));
      const zA = L.index === 0 ? -fa : z0 - slabT;
      const geo = new THREE.ExtrudeGeometry(sh, { depth: z0 - zA, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2); geo.translate(0, zA, 0);
      const m = new THREE.Mesh(geo, mat(L.index === 0 ? '#c9c5bd' : '#e9e6e0'));
      m.receiveShadow = true; m.castShadow = L.index > 0;
      group.add(m);
    }
    // Sols des pièces + plafond du dernier niveau
    for (const r of live) {
      if (voids.includes(r)) continue;
      const sh = shape(r.inner);
      const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat(FLOOR3D[r.room.floor] || '#ccc'));
      fl.rotation.x = -Math.PI / 2; fl.position.y = z0 + 0.6; fl.receiveShadow = true;
      group.add(fl);
      if (roofsOn && L.index === info.length - 1) {
        const ce = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat('#fbfaf7', { side: THREE.BackSide }));
        ce.rotation.x = -Math.PI / 2; ce.position.y = z0 + lv.height;
        group.add(ce);
      }
    }
    // Murs (couleur intérieure/extérieure par face)
    for (const w of lv.walls) {
      const g = G.get(w.id);
      if (!g) continue;
      for (const pc of wallPieces(w, g, lv.openings)) {
        const geo = extrudePoly(pc.poly, z0 + pc.z0, z0 + pc.z1);
        const pos = geo.attributes.position, nor = geo.attributes.normal;
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i += 3) {
          const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
          let c = C_TOP;
          if (Math.abs(ny) < 0.5) {
            const mx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, mz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
            const out = !inside(mx + nx * 6, mz + nz * 6);
            c = out && w.type === 'ext' ? C_EXT : C_INT;
          }
          for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const m = new THREE.Mesh(geo, wallMat);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        if (pc.z0 < 120) collideBy[L.index].push(pc.poly);
      }
    }
    // Parements extérieurs (peau texturée sur la face extérieure des murs)
    const outMap = levelData(lv).outside;
    for (const w of lv.walls) {
      if (w.type !== 'ext') continue;
      const g = G.get(w.id), out = outMap.get(w.id);
      if (!g || !out) continue;
      const F = wallFinish(w);
      const material = finishMaterial(F.type, F.color);
      const n = mul(g.n, out);
      for (const pc of wallPieces(w, g, lv.openings)) {
        const p0 = out > 0 ? pc.poly[0] : pc.poly[3], p1 = out > 0 ? pc.poly[1] : pc.poly[2];
        group.add(skinQuad(p0, p1, z0 + pc.z0, z0 + pc.z1, n, g, F.def.size, material));
      }
    }
    // Ouvertures
    for (const o of lv.openings) {
      const g = G.get(o.wallId);
      if (!g) continue;
      const J = joinery(o);
      const [s0, s1] = openingRange(o, g);
      const ow = s1 - s0;
      const ang = -Math.atan2(g.d.y, g.d.x);
      const wH = lv.walls.find((w) => w.id === o.wallId)?.height ?? lv.height;
      const h = Math.min(o.height, wH - o.sill);
      const zs = z0 + o.sill;
      const out = outMap.get(o.wallId) || 0;
      if (J.kind === 'door') {
        // battant ouvert à 90°
        const sh = o.hinge === 'end' ? s1 : s0;
        const hinge = pointOnWall(g, sh, o.side || 1);
        const mid = add(hinge, mul(mul(g.n, o.side || 1), ow / 2));
        group.add(box(mid.x, mid.y, z0, 4, ow - 2, h - 2, null, ang, colorMat(J.color, J.material === 'bois' ? 0.6 : 0.45)));
      } else if (J.kind === 'garage') {
        const c = add(pointOnWall(g, (s0 + s1) / 2, 0), mul(g.n, out * (g.t / 2 - 6)));
        group.add(box(c.x, c.y, zs, ow, 4, h, null, ang, colorMat(J.color, 0.5, J.material === 'alu' ? 0.3 : 0)));
        for (let z = 25; z < h - 5; z += 25) group.add(box(c.x + g.n.x * out * 2.2, c.y + g.n.y * out * 2.2, zs + z, ow - 4, 0.8, 1, null, ang, colorMat('#000000', 0.9)));
      } else {
        // menuiserie posée côté extérieur du mur (au milieu pour une cloison)
        const c = add(pointOnWall(g, (s0 + s1) / 2, 0), mul(g.n, out * Math.max(0, g.t / 2 - 7)));
        const jm = joineryMesh(o, ow, h);
        jm.position.set(c.x, zs, c.y);
        jm.rotation.y = ang;
        group.add(jm);
        // appui de fenêtre extérieur
        if (out && J.kind === 'window' && o.sill > 5) {
          const a = add(pointOnWall(g, (s0 + s1) / 2, 0), mul(g.n, out * (g.t / 2 + 1)));
          group.add(box(a.x, a.y, zs - 4, ow + 8, 8, 4, null, ang, colorMat('#d9d6cf', 0.8)));
        }
      }
    }
    // Mobilier
    for (const f of lv.furniture) {
      const def = FURNITURE[f.type];
      if (!def) continue;
      const a = (f.rot * Math.PI) / 180;
      for (const [x, y, z, sx, sy, sz, color] of def.parts(f.w, f.d, f.h)) {
        const p = add({ x: f.x, y: f.y }, { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
        group.add(box(p.x, p.y, z0 + z, sx, sy, sz, color, -a));
      }
    }
  }
  // Toitures
  if (roofsOn) {
    for (const r of d.roofs) {
      const geo = roofGeometry(r);
      topZ = Math.max(topZ, geo.ridgeZ);
      for (const f of geo.faces) {
        const m = f.kind === 'gable' ? finishMaterial(wallFinish({}).type, wallFinish({}).color) : mat(r.material === 'ardoise' ? '#4a525a' : r.material === 'zinc' ? '#8d969c' : '#a5543a', { side: THREE.DoubleSide });
        group.add(polyMesh(f.pts, m));
      }
    }
  }
  const sun = scene.userData.sun;
  sun.target.position.set(cx, 0, cy);
  sun.position.set(cx - 2500, 4000 + topZ * 0.5, cy + 3000);
  if (frame) {
    const size = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 800) * (d.parcel ? 1 : 1.35) + Math.max(0, topZ - 450) * 1.2;
    orbit.target.set(cx, Math.max(100, topZ * 0.4), cy);
    camera.position.set(cx + size * 0.9, size * 0.8, cy + size * 1.1);
    orbit.update();
  }
}

// ---------- Visite à pied ----------
export function startWalk() {
  const L = levelInfo()[store.doc.activeLevel];
  const rooms = levelData(L.level).rooms.filter((r) => r.inner && !r.dup && !(L.index > 0 && isVoidRoom(r.room.name)));
  const start = rooms.length ? rooms.sort((a, b) => b.area - a.area)[0].room.seed : { x: 0, y: 0 };
  collide = collideBy[L.index] || [];
  walkY = L.z0 + 160;
  camera.position.set(start.x, walkY, start.y);
  camera.rotation.set(0, 0, 0);
  orbit.enabled = false;
  walk.lock();
}

function blocked(x, y) {
  const r = 22;
  for (const poly of collide) {
    if (!poly) continue;
    if (pointInPoly({ x, y }, poly) || distToPolyEdges({ x, y }, poly) < r) return true;
  }
  return false;
}

function stepWalk(dt) {
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 320 : 160) * dt;
  let f = 0, s = 0;
  if (keys.KeyW || keys.KeyZ || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyA || keys.KeyQ || keys.ArrowLeft) s -= 1;
  if (keys.KeyD || keys.ArrowRight) s += 1;
  if (!f && !s) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0; dir.normalize();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const mv = dir.multiplyScalar(f * speed).add(right.multiplyScalar(s * speed));
  const p = camera.position;
  if (!blocked(p.x + mv.x, p.z)) p.x += mv.x;
  if (!blocked(p.x, p.z + mv.z)) p.z += mv.z;
}

export function snapshot() {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

let framed = false;
export function offscreenSnapshot(w, h) {
  if (!renderer) return null;
  if (built !== store.geomVersion || !framed) { rebuild(true); framed = true; }
  const old = renderer.getSize(new THREE.Vector2());
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!walk.isLocked) orbit.update();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setSize(Math.max(1, old.x), Math.max(1, old.y), false);
  camera.aspect = Math.max(1, old.x) / Math.max(1, old.y); camera.updateProjectionMatrix();
  return url;
}
export function markFramed() { framed = true; }
// Nouveau projet ouvert : la caméra sera recadrée au prochain affichage
export function resetFrame() { framed = false; built = -1; if (active) { rebuild(true); framed = true; } }
