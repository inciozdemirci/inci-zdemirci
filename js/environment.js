/**
 * environment.js — Örnek 1:70 mimari sahne + .glb/.gltf yükleyici
 *
 * Demo bina, gerçek bir 1:70 MAKET gibi modellenmiştir: tüm ölçüler bina metresi
 * olarak yazılır ve M() ile maket birimine çevrilir (3 m duvar → 0.0429 birim).
 * Sahne modelRoot altına eklenir; modelRoot.scale = payda olduğu için insan
 * gözünden 1:1 görünür (bkz. scale.js).
 *
 * Performans: Duvarlar, kapılar, kutular, ölçek referansları ve yön işaretleri
 * vertex color ile TEK bir geometride birleştirilir (1 draw call).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { AUTHORING_DENOMINATOR, REFERENCE_HUMAN_HEIGHT } from './scale.js';

/** Bina metresi → maket birimi (1:70) */
const M = (meters) => meters / AUTHORING_DENOMINATOR;

const WALL_H = 3.0;
const WALL_T = 0.2;
const DOOR_H = 2.1;

const C = {
  wall: 0xf0ece4,
  floor: 0xd9d4ca,
  frame: 0x355f93,
  leaf: 0x8a6a4a,
  human: 0x2f6fd6,
  head: 0xe8b48a,
  arrow: 0xf08a24,
  north: 0xd8402f,
  pole: 0x55606e,
  barDark: 0x222831,
  barLight: 0xfafafa,
};
const BOX_COLORS = [0x6cc4a1, 0x5ab0c8, 0x6b8fd6, 0x8f7ad6, 0xc874b8, 0xe0806a];

/** Birçok geometriyi vertex color ile birleştiren yardımcı. Girdiler bina metresidir. */
class GeometryBatch {
  constructor() {
    this.parts = [];
    this._m = new THREE.Matrix4();
    this._color = new THREE.Color();
  }

  _add(geometry, color) {
    this._color.set(color);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = this._color.r;
      colors[i * 3 + 1] = this._color.g;
      colors[i * 3 + 2] = this._color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  /** Kutu: (x, z) taban merkezi, y = alt yüz. */
  box(w, h, d, x, y, z, color, rotY = 0) {
    const g = new THREE.BoxGeometry(M(w), M(h), M(d));
    this._m.makeRotationY(rotY).setPosition(M(x), M(y + h / 2), M(z));
    g.applyMatrix4(this._m);
    this._add(g, color);
  }

  cylinder(r, h, x, y, z, color, segments = 12) {
    const g = new THREE.CylinderGeometry(M(r), M(r), M(h), segments);
    g.translate(M(x), M(y + h / 2), M(z));
    this._add(g, color);
  }

  sphere(r, x, y, z, color) {
    const g = new THREE.SphereGeometry(M(r), 12, 8);
    g.translate(M(x), M(y), M(z));
    this._add(g, color);
  }

  /** Zemine yatık ok. yaw: 0 = kuzey (−Z), +π/2 = batı, −π/2 = doğu */
  arrow(x, z, yaw, color, length = 0.9, width = 0.5) {
    const s = new THREE.Shape();
    const hw = width / 2;
    const sw = width * 0.18;
    const head = length * 0.45;
    s.moveTo(-sw, -length / 2);
    s.lineTo(sw, -length / 2);
    s.lineTo(sw, length / 2 - head);
    s.lineTo(hw, length / 2 - head);
    s.lineTo(0, length / 2);
    s.lineTo(-hw, length / 2 - head);
    s.lineTo(-sw, length / 2 - head);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.scale(M(1), M(1), M(1));
    g.rotateX(-Math.PI / 2); // +Y → −Z (kuzey), normal yukarı
    g.rotateY(yaw);
    g.translate(M(x), M(0.025), M(z));
    this._add(g, color);
  }

  build(material) {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return new THREE.Mesh(merged, material);
  }
}

/**
 * X ekseni boyunca duvar (z sabit). doors: [{c: merkez x, w: genişlik, open?: bool}]
 */
function wallAlongX(batch, x0, x1, z, doors = []) {
  let cursor = x0;
  for (const door of [...doors].sort((a, b) => a.c - b.c)) {
    const a = door.c - door.w / 2;
    const b = door.c + door.w / 2;
    if (a > cursor) batch.box(a - cursor, WALL_H, WALL_T, (cursor + a) / 2, 0, z, C.wall);
    batch.box(door.w, WALL_H - DOOR_H, WALL_T, door.c, DOOR_H, z, C.wall); // lento
    // kasa
    batch.box(0.06, DOOR_H, WALL_T + 0.06, a + 0.03, 0, z, C.frame);
    batch.box(0.06, DOOR_H, WALL_T + 0.06, b - 0.03, 0, z, C.frame);
    batch.box(door.w, 0.06, WALL_T + 0.06, door.c, DOOR_H - 0.06, z, C.frame);
    if (door.open) {
      const leafW = door.w - 0.1;
      batch.box(0.04, DOOR_H - 0.08, leafW, a + 0.08, 0, z + WALL_T / 2 + leafW / 2, C.leaf);
    }
    cursor = b;
  }
  if (x1 > cursor) batch.box(x1 - cursor, WALL_H, WALL_T, (cursor + x1) / 2, 0, z, C.wall);
}

/** Z ekseni boyunca duvar (x sabit). doors: [{c: merkez z, w, open?}] */
function wallAlongZ(batch, z0, z1, x, doors = []) {
  let cursor = z0;
  for (const door of [...doors].sort((a, b) => a.c - b.c)) {
    const a = door.c - door.w / 2;
    const b = door.c + door.w / 2;
    if (a > cursor) batch.box(WALL_T, WALL_H, a - cursor, x, 0, (cursor + a) / 2, C.wall);
    batch.box(WALL_T, WALL_H - DOOR_H, door.w, x, DOOR_H, door.c, C.wall);
    batch.box(WALL_T + 0.06, DOOR_H, 0.06, x, 0, a + 0.03, C.frame);
    batch.box(WALL_T + 0.06, DOOR_H, 0.06, x, 0, b - 0.03, C.frame);
    batch.box(WALL_T + 0.06, 0.06, door.w, x, DOOR_H - 0.06, door.c, C.frame);
    if (door.open) {
      const leafW = door.w - 0.1;
      batch.box(leafW, DOOR_H - 0.08, 0.04, x - WALL_T / 2 - leafW / 2, 0, a + 0.08, C.leaf);
    }
    cursor = b;
  }
  if (z1 > cursor) batch.box(WALL_T, WALL_H, z1 - cursor, x, 0, (cursor + z1) / 2, C.wall);
}

/** Kamerayı takip eden metin etiketi. heightM: bina metresi cinsinden yükseklik. */
function makeLabel(text, { heightM = 0.32, fg = '#11161f', bg = 'rgba(255,255,255,0.88)' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontPx = 56;
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const pad = 22;
  const w = Math.ceil(ctx.measureText(text).width + pad * 2);
  const h = fontPx + pad * 1.4;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillStyle = bg;
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(M(heightM * (w / h)), M(heightM), 1);
  sprite.name = `Label:${text}`;
  return sprite;
}

function place(obj, x, y, z) {
  obj.position.set(M(x), M(y), M(z));
  return obj;
}

/**
 * Demo binasını ve zemini oluşturur.
 * @returns {{root:THREE.Group, demo:THREE.Group, ground:THREE.Group, spawn:{position:THREE.Vector3, yaw:number}}}
 */
export function createEnvironment() {
  const root = new THREE.Group();
  root.name = 'Environment (maket birimi)';

  // ---------- Zemin ve grid (model yüklense de kalır) ----------
  const ground = new THREE.Group();
  ground.name = 'Ground';
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(M(80), M(80)),
    new THREE.MeshLambertMaterial({ color: 0xb9c2b4 }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  ground.add(groundMesh);

  const grid1 = new THREE.GridHelper(M(60), 60, 0x7b8794, 0x9aa5b0); // 1 m kareler
  grid1.position.y = M(0.03);
  grid1.material.transparent = true;
  grid1.material.opacity = 0.45;
  const grid5 = new THREE.GridHelper(M(60), 12, 0x3d4652, 0x4f5966); // 5 m kareler
  grid5.position.y = M(0.032);
  grid5.material.transparent = true;
  grid5.material.opacity = 0.7;
  ground.add(grid1, grid5);
  root.add(ground);

  // ---------- Demo bina ----------
  const demo = new THREE.Group();
  demo.name = 'DemoBuilding';
  const batch = new GeometryBatch();

  // iç döşeme
  batch.box(16, 0.02, 12, 0, 0, 0, C.floor);

  // dış duvarlar (16 × 12 m)
  wallAlongX(batch, -8.1, 8.1, -6, [{ c: -4, w: 0.9 }]);            // kuzey
  wallAlongX(batch, -8.1, 8.1, 6, [{ c: -3, w: 1.4 }]);             // güney — ana giriş
  wallAlongZ(batch, -5.9, 5.9, -8);                                  // batı
  wallAlongZ(batch, -5.9, 5.9, 8, [{ c: 3, w: 0.9, open: true }]);  // doğu
  // iç duvarlar
  wallAlongZ(batch, -5.9, 0.1, 0, [{ c: -3, w: 0.9, open: true }]); // A: x = 0
  wallAlongX(batch, 0.1, 7.9, 0, [{ c: 4, w: 0.9, open: true }]);   // B: z = 0

  // farklı yüksekliklerde kutular (batı duvarı boyunca)
  const heights = [0.45, 0.75, 0.9, 1.2, 1.7, 2.4];
  const boxZ = [-4, -2.4, -0.8, 0.8, 2.4, 4.0];
  const labels = [];
  heights.forEach((h, i) => {
    batch.box(0.5, h, 0.5, -7, 0, boxZ[i], BOX_COLORS[i]);
    labels.push(place(makeLabel(`${h.toFixed(2)} m`, { heightM: 0.22 }), -7, h + 0.22, boxZ[i]));
  });

  // kuzeydoğu oda: masa ve dolap, sütun
  batch.box(1.6, 0.75, 0.8, 4, 0, -3, 0xb08b62);
  batch.box(0.6, 2.1, 0.45, 7.5, 0, -5, 0x9c8a76);
  batch.box(0.4, WALL_H, 0.4, -4, 0, -3, 0xc9c3b8); // sütun (batı salon)

  // 1.70 m insan referansı
  const hx = -1.5;
  const hz = 3.5;
  batch.cylinder(0.17, 1.46, hx, 0, hz, C.human);
  batch.sphere(0.12, hx, REFERENCE_HUMAN_HEIGHT - 0.12, hz, C.head);
  labels.push(place(makeLabel(`İnsan ${REFERENCE_HUMAN_HEIGHT.toFixed(2)} m · 1:${AUTHORING_DENOMINATOR} maket`, { heightM: 0.2 }), hx, 2.0, hz));

  // ölçek çubuğu: 5 × 1 m
  for (let i = 0; i < 5; i++) {
    batch.box(1, 0.02, 0.15, -6.5 + i, 0.02, 5.3, i % 2 ? C.barLight : C.barDark);
  }
  labels.push(place(makeLabel('0 ─ 5 m  ·  grid: 1 m / 5 m', { heightM: 0.18 }), -4.5, 0.35, 5.3));

  // yön okları (rota)
  [[-3, 3], [-3, 1], [-3, -1]].forEach(([x, z]) => batch.arrow(x, z, 0, C.arrow));
  batch.arrow(-1.5, -3, -Math.PI / 2, C.arrow);   // doğuya → kapı A
  batch.arrow(2, -3, -Math.PI / 2, C.arrow);
  batch.arrow(4, -1.2, Math.PI, C.arrow);         // güneye → kapı B
  batch.arrow(4, 1.5, Math.PI, C.arrow);
  batch.arrow(6, 3, -Math.PI / 2, C.arrow);       // doğuya → doğu kapısı
  batch.arrow(-3, 4.7, 0, C.north, 0.6, 0.35);    // başlangıçta kuzey oku

  // pusula direkleri
  const compass = [
    ['K (Kuzey)', 0, -10, C.north],
    ['G (Güney)', 0, 10, C.pole],
    ['D (Doğu)', 11, 0, C.pole],
    ['B (Batı)', -11, 0, C.pole],
  ];
  for (const [text, x, z, color] of compass) {
    batch.cylinder(0.07, 2.6, x, 0, z, color, 8);
    labels.push(place(makeLabel(text, { heightM: 0.4, fg: color === C.north ? '#b3261e' : '#11161f' }), x, 3.0, z));
  }
  labels.push(place(makeLabel('Giriş', { heightM: 0.25 }), -3, 2.5, 6.3));

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const buildingMesh = batch.build(material);
  buildingMesh.name = 'DemoBuildingBatched';
  demo.add(buildingMesh, ...labels);
  root.add(demo);

  return {
    root,
    demo,
    ground,
    // başlangıç: giriş kapısının içi, kuzeye bakış (maket birimi)
    spawn: { position: new THREE.Vector3(M(-3), 0, M(4.5)), yaw: 0 },
  };
}

/**
 * URL parametresinden model birim ölçeği.
 *  'maket' | 'model' → dosya 1:payda maket metresinde (varsayılan, 1)
 *  'real'  | 'bina'  → dosya gerçek boyutlu bina metresinde (1/payda)
 *  'mm-maket'        → maket milimetresi (0.001)
 *  sayı              → doğrudan çarpan
 */
export function parseUnitScale(value, denominator) {
  if (!value) return 1;
  const v = String(value).toLowerCase();
  if (v === 'maket' || v === 'model') return 1;
  if (v === 'real' || v === 'bina') return 1 / denominator;
  if (v === 'mm-maket') return 0.001;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * .glb / .gltf mimari model yükler. Dönen grup modelRoot'a (maket uzayı) eklenmelidir.
 * @param {string} url  sayfaya göre göreli veya mutlak URL
 * @param {{unitScale?:number, onProgress?:(ratio:number)=>void}} options
 */
export async function loadArchitectureModel(url, { unitScale = 1, onProgress } = {}) {
  const resolved = new URL(url, document.baseURI).href; // GitHub Pages alt dizinlerinde de çalışır
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
  try {
    const gltf = await loader.loadAsync(resolved, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });
    const group = new THREE.Group();
    group.name = `LoadedModel:${url}`;
    gltf.scene.scale.multiplyScalar(unitScale);
    group.add(gltf.scene);
    return group;
  } finally {
    draco.dispose();
  }
}
