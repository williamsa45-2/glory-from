import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { ARENA_MAP } from '../shared/maps.js';
import { createEnvironment } from './environment.js';
import { sandTexture } from './textures.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

// Cada textura cubre 2 m x 2 m del mundo.
function stoneTexture() {
  const rand = rng(5);
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#6f6b64';
    g.fillRect(0, 0, s, s);
    const rows = 8;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const cols = r % 2 ? 4 : 5;
      const cw = s / 4;
      for (let c = -1; c < cols; c++) {
        const x = c * cw + (r % 2 ? cw / 2 : 0) + rand() * 3;
        const l = 38 + rand() * 14;
        g.fillStyle = `hsl(${30 + rand() * 12}, ${6 + rand() * 8}%, ${l}%)`;
        g.fillRect(x + 2, r * rh + 2, cw - 4, rh - 4);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `hsla(30, 8%, ${l - 10 + rand() * 20}%, 0.25)`;
          g.fillRect(x + rand() * cw, r * rh + rand() * rh, 2 + rand() * 6, 1 + rand() * 2);
        }
      }
    }
    g.strokeStyle = 'rgba(20,18,15,0.7)';
    g.lineWidth = 3;
    for (let r = 0; r <= rows; r++) {
      g.beginPath();
      g.moveTo(0, r * rh);
      g.lineTo(s, r * rh);
      g.stroke();
    }
  });
}

function crateTexture() {
  const rand = rng(9);
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#8a5a2b';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const y = (i * s) / 8;
      g.fillStyle = `hsl(${28 + rand() * 6}, ${40 + rand() * 12}%, ${36 + rand() * 10}%)`;
      g.fillRect(0, y, s, s / 8 - 2);
      for (let k = 0; k < 20; k++) {
        g.fillStyle = 'rgba(40,20,5,0.3)';
        g.fillRect(rand() * s, y + rand() * (s / 8), 10 + rand() * 40, 1);
      }
    }
    g.strokeStyle = '#4b2f14';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath();
    g.moveTo(10, 10);
    g.lineTo(s - 10, s - 10);
    g.moveTo(s - 10, 10);
    g.lineTo(10, s - 10);
    g.stroke();
  });
}

/** Caja con UV en metros (una textura = 2 m) para que los ladrillos no se estiren. */
function boxGeometry(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // caras: +x, -x, +y, -y, +z, -z  (4 vértices cada una)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / 2, (uv.getY(i) * dims[f][1]) / 2);
    }
  }
  g.translate(x, y, z);
  return g;
}

export function createArena(scene, renderer) {
  const half = ARENA_MAP.half;
  const env = createEnvironment(scene, renderer, { fogDensity: 0.006, shadowExtent: 36, sunTarget: new THREE.Vector3(0, 0, 0) });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ map: sandTexture([112, 112]), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // círculo central decorativo
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.0, 48),
    new THREE.MeshStandardMaterial({ color: 0x5b4a30, roughness: 1 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  scene.add(ring);

  const byKind = { stone: [], dark: [], crate: [] };
  for (const b of ARENA_MAP.boxes) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const g = boxGeometry(w, h, d, (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    (b.kind === 'crate' ? byKind.crate : b.kind === 'pillar' ? byKind.dark : byKind.stone).push(g);
  }
  const mats = {
    stone: new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0xb0a8a0, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 }),
  };
  for (const [k, geos] of Object.entries(byKind)) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mats[k]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // estandartes en los muros exteriores
  const bannerColors = [0xa8322c, 0x2c5ea8, 0xc9a227, 0x2f7d46];
  const bannerGeo = new THREE.PlaneGeometry(1.4, 2.6);
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([sx, sz], i) => {
    for (const off of [-14, 0, 14]) {
      const m = new THREE.Mesh(bannerGeo, new THREE.MeshStandardMaterial({ color: bannerColors[(i + (off > 0 ? 1 : 0)) % 4], roughness: 0.9, side: THREE.DoubleSide }));
      const along = sz === 0 ? off : off;
      m.position.set(sx * (half - 0.05) + (sx === 0 ? along : 0), 2.6, sz * (half - 0.05) + (sz === 0 ? along : 0));
      m.rotation.y = sx !== 0 ? -sx * Math.PI / 2 : sz > 0 ? Math.PI : 0;
      scene.add(m);
    }
  });

  return { env, sun: env.sun, update: (t, dt, wind, camera) => env.update(camera, dt, 0) };
}
