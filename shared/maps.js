// Datos de los mapas. Los leen el servidor (colisiones, apariciones) y el cliente (para dibujarlos).

export const TARGET_CENTER_Y = 1.2;
export const TARGET_TILT = (10 * Math.PI) / 180;
export const BOSS_DEPTH = 0.18;

/** Zona por la que puede moverse el arquero en el campo de tiro (coordenadas de la cabeza). */
export const DECK = { xMin: -6.8, xMax: 6.8, zMin: -0.35, zMax: 4.2 };

export const LANES = [
  { x: -6, dist: 10, diameter: 0.4 },
  { x: -3, dist: 20, diameter: 0.6 },
  { x: 0, dist: 30, diameter: 0.8 },
  { x: 3, dist: 50, diameter: 1.22 },
  { x: 6, dist: 70, diameter: 1.22 },
];

function makeTargets() {
  const ny = Math.sin(TARGET_TILT);
  const nz = Math.cos(TARGET_TILT);
  return LANES.map((l, index) => {
    const R = l.diameter / 2;
    return {
      index,
      distance: l.dist,
      faceRadius: R,
      bossRadius: R + 0.09,
      normal: [0, ny, nz],
      center: [l.x, TARGET_CENTER_Y + ny * (BOSS_DEPTH / 2), -l.dist + nz * (BOSS_DEPTH / 2)],
    };
  });
}

const box = (cx, cz, w, d, h, kind = 'wall', y0 = 0) => ({
  kind,
  min: [cx - w / 2, y0, cz - d / 2],
  max: [cx + w / 2, y0 + h, cz + d / 2],
});

// Armero del entrenamiento: las armas están en un soporte (a la derecha de la plataforma) y se cogen con E / agarre.
const RACK_Z = [0.4, 0.9, 1.4, 1.9, 2.4, 2.9];
const RACK_TYPES = ['sword', 'axe', 'spear', 'bow', 'crossbow', 'sling'];

export const TRAINING_MAP = {
  id: 'training',
  targets: makeTargets(),
  // junto a la línea de tiro para poder alcanzarlos cuerpo a cuerpo desde la plataforma
  dummies: [
    { x: -4.5, z: -1.6 },
    { x: 1.5, z: -1.6 },
    { x: 4.5, z: -1.6 },
  ],
  boxes: [],
  rack: { pos: [7.1, 0, 1.65], width: 3.2, types: RACK_TYPES }, // lateral derecho de la plataforma, mirando al centro
  items: RACK_TYPES.map((type, i) => ({
    type,
    pos: [7.0, 1.0, RACK_Z[i]],
    rack: true,
  })),
  spawns: [{ x: 0, z: 1.2, yaw: 0 }],
};

// --- Arena PvP -------------------------------------------------------------------
const arenaBoxes = [];
const HALF = 25;
// muros exteriores
arenaBoxes.push(box(0, -HALF - 0.5, 52, 1, 4.5), box(0, HALF + 0.5, 52, 1, 4.5));
arenaBoxes.push(box(-HALF - 0.5, 0, 1, 52, 4.5), box(HALF + 0.5, 0, 1, 52, 4.5));
// pilares centrales
for (const sx of [-1, 1]) for (const sz of [-1, 1]) arenaBoxes.push(box(sx * 5, sz * 5, 1.4, 1.4, 4, 'pillar'));
// muros bajos (se puede disparar por encima y saltar)
arenaBoxes.push(box(0, -10, 8, 0.6, 1.2, 'low'), box(0, 10, 8, 0.6, 1.2, 'low'));
arenaBoxes.push(box(-13, 0, 0.6, 8, 1.2, 'low'), box(13, 0, 0.6, 8, 1.2, 'low'));
// esquinas en L
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    arenaBoxes.push(box(sx * 16, sz * 18, 6, 0.6, 1.2, 'low'), box(sx * 19, sz * 15, 0.6, 6, 1.2, 'low'));
  }
}
// muros altos laterales
arenaBoxes.push(box(-8.5, 0, 0.8, 7, 3.2), box(8.5, 0, 0.8, 7, 3.2));
// cajas
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    arenaBoxes.push(box(sx * 20, sz * 7, 1.2, 1.2, 1.2, 'crate'), box(sx * 20, sz * 7, 1.2, 1.2, 1.2, 'crate', 1.2));
    arenaBoxes.push(box(sx * 21.4, sz * 7, 1.2, 1.2, 1.2, 'crate'));
    arenaBoxes.push(box(sx * 7, sz * 20, 1.2, 1.2, 1.2, 'crate'), box(sx * 8.4, sz * 20, 1.2, 1.2, 1.2, 'crate'));
  }
}

const stoneSpots = [
  [3, 12], [-3, -12], [12, -3], [-12, 3], [-3, 12], [3, -12], [12, 3], [-12, -3], [0, 2], [0, -2], [-17, 0], [17, 0],
];
const quiverSpots = [[6, 16], [-6, -16], [16, -6], [-16, 6]];
const boltSpots = [[-6, 16], [6, -16], [-16, -6], [16, 6]];
const weaponSpots = [
  ['sword', -7, -7], ['axe', 7, 7], ['spear', 7, -7], ['bow', -7, 7], ['crossbow', 0, -21], ['sling', 0, 21],
];

export const ARENA_MAP = {
  id: 'arena',
  half: HALF,
  boxes: arenaBoxes,
  targets: [],
  dummies: [],
  bounds: { min: [-HALF + 0.4, -HALF + 0.4], max: [HALF - 0.4, HALF - 0.4] },
  spawns: [
    [-21, -21], [21, -21], [-21, 21], [21, 21], [0, -22], [0, 22], [-22, 0], [22, 0],
  ].map(([x, z]) => ({ x, z, yaw: Math.atan2(x, z) })),
  items: [
    ...stoneSpots.map(([x, z]) => ({ type: 'stone', count: 1, pos: [x, 0.03, z], every: 14 })),
    ...quiverSpots.map(([x, z]) => ({ type: 'arrow', count: 4, pos: [x, 0.05, z], every: 25 })),
    ...boltSpots.map(([x, z]) => ({ type: 'bolt', count: 3, pos: [x, 0.05, z], every: 30 })),
    ...weaponSpots.map(([type, x, z]) => ({ type, count: 1, pos: [x, 0.05, z], every: 35 })),
  ],
};

export const MAPS = { training: TRAINING_MAP, arena: ARENA_MAP };
