import * as THREE from 'three';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Ruido de valores fractal que se repite sin costuras (la malla de valores se envuelve). Devuelve Float32Array en [0,1]. */
export function tileableFbm(size, { baseCells = 4, octaves = 4, persistence = 0.5, seed = 1 } = {}) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells * 2 ** o;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = smoother(fy - y0);
      const ya = y0 % cells;
      const yb = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = smoother(fx - x0);
        const xa = x0 % cells;
        const xb = (x0 + 1) % cells;
        const v00 = lattice[ya * cells + xa];
        const v10 = lattice[ya * cells + xb];
        const v01 = lattice[yb * cells + xa];
        const v11 = lattice[yb * cells + xb];
        const top = v00 + (v10 - v00) * tx;
        const bot = v01 + (v11 - v01) * tx;
        out[y * size + x] += (top + (bot - top) * ty) * amp;
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Trazo que se envuelve por los bordes para no dejar costuras al repetir la textura. */
function wrapLine(g, size, x1, y1, x2, y2) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const minX = Math.min(x1, x2) + ox;
      const maxX = Math.max(x1, x2) + ox;
      const minY = Math.min(y1, y2) + oy;
      const maxY = Math.max(y1, y2) + oy;
      if (maxX < 0 || minX > size || maxY < 0 || minY > size) continue;
      g.beginPath();
      g.moveTo(x1 + ox, y1 + oy);
      g.lineTo(x2 + ox, y2 + oy);
      g.stroke();
    }
  }
}

function toTexture(canvas, repeat) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

/** Césped: manchas suaves de tono + briznas finas. `lift` aclara la textura (franjas del corte). */
export function grassTexture(repeat, { seed = 7, lift = 0, size = 512, blades = 9000 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const big = tileableFbm(size, { baseCells: 3, octaves: 4, persistence: 0.55, seed });
  const fine = tileableFbm(size, { baseCells: 24, octaves: 2, persistence: 0.5, seed: seed + 11 });
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = big[i];
    const f = fine[i];
    const l = 0.2 + lift + n * 0.2 + (f - 0.5) * 0.08;
    const hue = 0.24 + (n - 0.5) * 0.06;
    const col = new THREE.Color().setHSL(hue, 0.42 + n * 0.12, l);
    img.data[i * 4] = Math.round(col.r * 255);
    img.data[i * 4 + 1] = Math.round(col.g * 255);
    img.data[i * 4 + 2] = Math.round(col.b * 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const rand = rng(seed + 100);
  g.lineCap = 'round';
  for (let i = 0; i < blades; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 4 + rand() * 9;
    const ang = -Math.PI / 2 + (rand() - 0.5) * 1.3;
    const shade = rand();
    g.strokeStyle = `hsla(${88 + rand() * 30}, ${38 + rand() * 25}%, ${(20 + lift * 100 + shade * 26).toFixed(1)}%, ${0.35 + rand() * 0.35})`;
    g.lineWidth = 0.8 + rand() * 1.1;
    wrapLine(g, size, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  return toTexture(c, repeat);
}

/** Arena: arena clara con ondulaciones suaves, grano y algunas piedrecillas. */
export function sandTexture(repeat, { seed = 21, size = 512 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const big = tileableFbm(size, { baseCells: 3, octaves: 5, persistence: 0.5, seed });
  const grain = tileableFbm(size, { baseCells: 64, octaves: 1, seed: seed + 5 });
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = big[i];
    const k = lerp(0.62, 0.9, n) + (grain[i] - 0.5) * 0.12;
    img.data[i * 4] = Math.round(190 * k);
    img.data[i * 4 + 1] = Math.round(158 * k);
    img.data[i * 4 + 2] = Math.round(108 * k);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const rand = rng(seed + 9);
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.8 + rand() * 2.2;
    g.fillStyle = `hsla(${28 + rand() * 12}, ${10 + rand() * 20}%, ${32 + rand() * 30}%, 0.7)`;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.lineCap = 'round';
  for (let i = 0; i < 50; i++) {
    g.strokeStyle = 'rgba(95,72,42,0.22)';
    g.lineWidth = 1 + rand() * 1.5;
    const x = rand() * size;
    const y = rand() * size;
    wrapLine(g, size, x, y, x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90);
  }
  return toTexture(c, repeat);
}
