// Pruebas del simulador: node server/sim.test.mjs
import assert from 'node:assert/strict';
import { Sim } from '../shared/sim.js';
import { MAPS } from '../shared/maps.js';
import { solveElevation } from '../shared/physics.js';
import { WEAPONS, makeInventory, pickBlockReason, giveWeapon, primaryAction } from '../shared/weapons.js';
import * as THREE from 'three';
import { pushOutOfBoxes, supportHeight } from '../shared/geometry.js';
import { createBody, stepVertical } from '../src/movement.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

function mk(mapId, mode) {
  const log = [];
  const sim = new Sim({ map: MAPS[mapId], mode, emit: (m, to) => log.push({ ...m, _to: to }) });
  return { sim, log, evs: (t) => log.filter((e) => e.t === t) };
}
const run = (sim, seconds) => {
  for (let i = 0; i < seconds * 60; i++) sim.step();
};
const look = (sim, id, x, y, z) => {
  sim.players.get(id).lastPoseAt = 0; // permite teletransportar en el test
  sim.handle(id, { t: 'pose', h: [x, y, z, 0, 0, 0, 1], w: null, a: 0 });
};

console.log('Reglas de inventario');
test('espada y hacha no pueden llevarse a la vez', () => {
  const inv = makeInventory({ melee: 'sword' });
  assert.match(pickBlockReason(inv, 'axe'), /No puedes llevar hacha y espada/);
  assert.equal(pickBlockReason(makeInventory({ melee: 'axe' }), 'sword') !== null, true);
});
test('arco, ballesta y honda son excluyentes entre sí', () => {
  for (const [a, b] of [['bow', 'crossbow'], ['bow', 'sling'], ['crossbow', 'sling'], ['sling', 'bow'], ['crossbow', 'bow']]) {
    assert.notEqual(pickBlockReason(makeInventory({ ranged: a }), b), null, `${a} vs ${b}`);
  }
});
test('lanza compatible con espada/hacha y con cualquier arma de distancia', () => {
  const inv = makeInventory({ melee: 'sword', spear: true, ranged: 'sling' });
  assert.equal(inv.melee, 'sword');
  assert.equal(inv.spear, true);
  assert.equal(inv.ranged, 'sling');
});
test('el loadout inválido se sanea (espada+hacha → solo una)', () => {
  const inv = makeInventory({ melee: 'sword', ranged: 'bow' });
  assert.equal(inv.melee, 'sword');
  const bad = makeInventory({ melee: 'axe', ranged: 'laser' });
  assert.equal(bad.ranged, null);
});
test('ballesta: menos flechas que el arco; honda empieza con 1 piedra', () => {
  assert.ok(WEAPONS.crossbow.maxAmmo < WEAPONS.bow.maxAmmo);
  assert.equal(makeInventory({ ranged: 'sling' }).ammo, 1);
  assert.equal(makeInventory({ ranged: 'bow' }).ammo, 12);
  assert.equal(makeInventory({ ranged: 'crossbow' }).ammo, 6);
});
test('la ballesta tiene más alcance (menos caída) que el arco', () => {
  const dropBow = solveElevation('arrow', 70, 0, WEAPONS.bow.speed);
  const dropXbow = solveElevation('bolt', 70, 0, WEAPONS.crossbow.speed);
  assert.ok(dropXbow < dropBow, `${dropXbow} < ${dropBow}`);
});

console.log('Movimiento (correr/saltar)');
const crate = { min: new THREE.Vector3(-0.6, 0, -0.6), max: new THREE.Vector3(0.6, 1.2, 0.6) };
test('una caja de 1,2 m bloquea a pie pero se puede pisar desde arriba', () => {
  const p = new THREE.Vector3(0.5, 0, 0);
  assert.equal(pushOutOfBoxes(p, 0.35, [crate], 0), true, 'a pie: bloquea');
  assert.equal(supportHeight(new THREE.Vector3(0, 0, 0), [crate], 0), 0, 'desde el suelo no se pisa');
  const q = new THREE.Vector3(0.5, 0, 0);
  assert.equal(pushOutOfBoxes(q, 0.35, [crate], 1.0), false, 'con los pies a 1,0 m no bloquea');
  assert.equal(supportHeight(new THREE.Vector3(0, 0, 0), [crate], 1.0), 1.2, 'se apoya en la cara superior');
});
test('el salto llega a ~1,3 m y vuelve al suelo; no se salta en el aire', () => {
  const body = createBody();
  let apex = 0;
  stepVertical(body, 1 / 60, () => 0, true);
  for (let i = 0; i < 120; i++) {
    stepVertical(body, 1 / 60, () => 0, true); // pulsar salto en el aire no hace nada
    apex = Math.max(apex, body.y);
    if (body.grounded) break;
  }
  assert.ok(apex > 1.2 && apex < 1.4, 'apex=' + apex);
  assert.equal(body.grounded, true);
});
test('saltando se sube a una caja y se queda encima', () => {
  const body = createBody();
  const pos = new THREE.Vector3(0.9, 0, 0); // junto a la caja
  stepVertical(body, 1 / 60, (f) => supportHeight(pos, [crate], f), true);
  for (let i = 0; i < 25; i++) {
    stepVertical(body, 1 / 60, (f) => supportHeight(pos, [crate], f), false);
    if (body.y > 0.9) pos.x = 0.3; // ya por encima de la caja: avanza sobre ella
  }
  for (let i = 0; i < 60; i++) stepVertical(body, 1 / 60, (f) => supportHeight(pos, [crate], f), false);
  assert.ok(Math.abs(body.y - 1.2) < 1e-6, 'y=' + body.y);
});
test('el cuerpo de un jugador subido a una caja no recibe flechas que pasan por debajo', () => {
  const { sim, evs } = mk('arena', 'pvp');
  sim.addPlayer('A', { loadout: { ranged: 'bow' } });
  const b = sim.addPlayer('B', { loadout: { ranged: 'bow' } });
  sim.players.get('A').lastPoseAt = 0;
  sim.handle('A', { t: 'pose', h: [2, 1.65, -12, 0, 0, 0, 1] });
  b.lastPoseAt = 0;
  sim.handle('B', { t: 'pose', h: [2, 1.2 + 1.65, 8, 0, 0, 0, 1] }); // de pie sobre algo de 1,2 m
  const el = solveElevation('arrow', 20.3, 0, WEAPONS.bow.speed);
  // un disparo a la altura de los pies del suelo pasa por debajo (y por encima del hueco libre)
  sim.handle('A', { t: 'fire', o: [2, 0.9, -12], d: [0, Math.sin(el * 0.9), Math.cos(el * 0.9)], p: 1 });
  run(sim, 2);
  assert.equal(b.hp, 100);
});

console.log('Entrenamiento');
test('flecha a 30 m con la elevación calculada → X', () => {
  const { sim, evs } = mk('training', 'training');
  sim.addPlayer('me', {});
  look(sim, 'me', 0, 1.65, 1.2);
  const t = sim.targets[2]; // diana de 30 m
  const a = solveElevation('arrow', 1.2 - t.center[2], t.center[1] - 1.555, WEAPONS.bow.speed);
  sim.handle('me', { t: 'fire', o: [0, 1.555, 1.2], d: [0, Math.sin(a), -Math.cos(a)], p: 1 });
  run(sim, 2);
  const score = evs('score');
  assert.equal(score.length, 1);
  assert.equal(score[0].ring, 10);
  assert.equal(score[0].label, 'X');
});
test('munición infinita en entrenamiento', () => {
  const { sim } = mk('training', 'training');
  const p = sim.addPlayer('me', {});
  for (let i = 0; i < 30; i++) {
    sim.handle('me', { t: 'fire', o: [0, 1.6, 1.2], d: [0, 0.1, -1], p: 1 });
    run(sim, 0.5);
  }
  assert.equal(p.inv.ammo, WEAPONS.bow.maxAmmo);
});
test('lanzar el hacha: sale del inventario pero se queda en el mundo', () => {
  const { sim, log } = mk('training', 'training');
  const p = sim.addPlayer('me', {});
  // coge hacha del armero
  const axe = [...sim.items.values()].find((i) => i.type === 'axe');
  look(sim, 'me', 5, 1.65, 3);
  sim.handle('me', { t: 'pickup', id: axe.id });
  assert.equal(p.inv.melee, 'axe');
  sim.handle('me', { t: 'select', slot: 'melee' });
  assert.equal(primaryAction(p.inv), 'throw', 'el hacha siempre está lista para lanzarse');
  sim.handle('me', { t: 'mode' }); // no hay modos que alternar
  assert.equal(primaryAction(p.inv), 'throw');
  sim.handle('me', { t: 'melee', o: [5, 1.6, 3], d: [0, 0, -1], v: 1 });
  assert.ok(log.some((e) => e.t === 'swing'), 'el hacha también golpea, sin modo cuerpo a cuerpo');
  run(sim, 1); // cadencia del golpe antes de poder lanzarla
  sim.handle('me', { t: 'throw', o: [5, 1.6, 3], d: [0, 0.05, -1], p: 1 });
  assert.equal(p.inv.melee, null, 'ya no está en el inventario');
  run(sim, 3);
  const thrown = [...sim.items.values()].filter((i) => i.type === 'axe' && !i.rack);
  assert.equal(thrown.length, 1, 'el hacha sigue en el mundo');
  assert.ok(log.some((e) => e.t === 'proj' && e.type === 'axe'));
});
test('la lanza lanzada también persiste, y collect la devuelve', () => {
  const { sim } = mk('training', 'training');
  const p = sim.addPlayer('me', {});
  const sp = [...sim.items.values()].find((i) => i.type === 'spear');
  look(sim, 'me', 5, 1.65, 3);
  sim.handle('me', { t: 'pickup', id: sp.id });
  assert.equal(p.inv.spear, true);
  sim.handle('me', { t: 'select', slot: 'spear' });
  sim.handle('me', { t: 'mode' });
  sim.handle('me', { t: 'throw', o: [5, 1.6, 3], d: [0, 0.1, -1], p: 1 });
  assert.equal(p.inv.spear, false);
  run(sim, 4);
  assert.equal([...sim.items.values()].filter((i) => i.type === 'spear' && !i.rack).length, 1);
  sim.handle('me', { t: 'collect' });
  assert.equal(p.inv.spear, true);
});
test('espada contra muñeco de entrenamiento', () => {
  const { sim, evs } = mk('training', 'training');
  sim.addPlayer('me', { loadout: { melee: 'sword' } });
  const dm = sim.dummies[0].pos; // junto a la línea de tiro
  look(sim, 'me', dm.x, 1.65, dm.z + 1.3);
  sim.handle('me', { t: 'melee', o: [dm.x, 1.4, dm.z + 1.0], d: [0, 0, -1], v: 1 });
  assert.equal(evs('hit').length, 1);
  assert.ok(evs('hit')[0].dmg > 0);
});

console.log('PvP');
function duel() {
  const ctx = mk('arena', 'pvp');
  const a = ctx.sim.addPlayer('A', { name: 'A', loadout: { melee: 'sword', spear: true, ranged: 'bow' } });
  const b = ctx.sim.addPlayer('B', { name: 'B', loadout: { melee: 'axe', ranged: 'sling' } });
  look(ctx.sim, 'A', 2, 1.65, -12);
  look(ctx.sim, 'B', 2, 1.65, 8);
  return { ...ctx, a, b };
}
test('flecha contra otro jugador le quita vida', () => {
  const { sim, a, b, evs } = duel();
  const el = solveElevation('arrow', 20, 0, WEAPONS.bow.speed);
  sim.handle('A', { t: 'fire', o: [2, 1.65, -12], d: [0, Math.sin(el), Math.cos(el)], p: 1 });
  run(sim, 2);
  assert.ok(b.hp < 100, 'B herido, hp=' + b.hp);
  assert.equal(a.inv.ammo, 11);
  assert.ok(evs('hit').length >= 1);
});
test('un muro bloquea el proyectil', () => {
  const { sim, b } = duel();
  look(sim, 'A', -4, 1.65, -3.2);
  look(sim, 'B', 4, 1.65, -3.2); // entre ambos: pilar en (-5,-5)? usamos muro alto en x=±8.5
  look(sim, 'A', -12, 1.65, 0);
  look(sim, 'B', -5, 1.65, 0); // el muro alto de x=-8.5 (z -3.5..3.5) está en medio
  sim.handle('A', { t: 'fire', o: [-12, 1.65, 0], d: [1, 0.03, 0], p: 1 });
  run(sim, 2);
  assert.equal(b.hp, 100);
});
test('muerte: suelta las armas al suelo y suma una baja', () => {
  const { sim, a, b, evs } = duel();
  look(sim, 'A', 2, 1.65, 0);
  look(sim, 'B', 2, 1.65, -1);
  sim.handle('A', { t: 'select', slot: 'melee' });
  for (let i = 0; i < 6 && b.alive; i++) {
    sim.handle('A', { t: 'melee', o: [2, 1.5, 0], d: [0, 0, -1], v: 1.3 });
    run(sim, 1);
  }
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.equal(evs('kill').length, 1);
  const dropped = [...sim.items.values()].filter((i) => ['axe', 'sling'].includes(i.type) && !i.spawner);
  assert.equal(dropped.length, 2, 'axe y honda caídas');
});
test('regla PvP: con espada no se recoge el hacha; con arco no la ballesta', () => {
  const { sim, a } = duel();
  look(sim, 'A', 0, 1.65, 10);
  const axe = sim.addItem({ type: 'axe', pos: [0, 0.05, 9.5] });
  sim.handle('A', { t: 'pickup', id: axe.id });
  assert.equal(a.inv.melee, 'sword');
  assert.ok(sim.items.has(axe.id));
  const xb = sim.addItem({ type: 'crossbow', pos: [0, 0.05, 9.5] });
  sim.handle('A', { t: 'pickup', id: xb.id });
  assert.equal(a.inv.ranged, 'bow');
  // tras soltar el arco sí se puede
  sim.handle('A', { t: 'select', slot: 'ranged' });
  sim.handle('A', { t: 'drop' });
  assert.equal(a.inv.ranged, null);
  sim.handle('A', { t: 'pickup', id: xb.id });
  assert.equal(a.inv.ranged, 'crossbow');
  assert.equal(a.inv.ammo, 1, 'la ballesta recogida trae su munición (1)');
});
test('honda: la piedra del suelo da munición automáticamente', () => {
  const { sim, b } = duel();
  assert.equal(b.inv.ammo, 1);
  look(sim, 'B', 4.5, 1.65, 14.5);
  sim.addItem({ type: 'stone', pos: [4.5, 0.03, 14.5], ttl: 30 });
  run(sim, 0.2);
  assert.equal(b.inv.ammo, 2);
});
test('disparar sin munición se rechaza', () => {
  const { sim, evs, b } = duel();
  b.inv.ammo = 0;
  const n = sim.projectiles.length;
  sim.handle('B', { t: 'fire', o: [10, 1.65, 0], d: [-1, 0, 0], p: 1 });
  assert.equal(sim.projectiles.length, n);
  assert.ok(evs('msg').length >= 1);
});
test('anti-teletransporte: un salto enorme de posición se recorta', () => {
  const { sim, a } = duel();
  sim.handle('A', { t: 'pose', h: [2, 1.65, -12, 0, 0, 0, 1] });
  sim.handle('A', { t: 'pose', h: [2, 1.65, 20, 0, 0, 0, 1] });
  assert.ok(a.head.z < -9, 'z=' + a.head.z);
});
test('el servidor ignora peticiones falsas (loadout trucado, números raros)', () => {
  const { sim, a } = duel();
  sim.handle('A', { t: 'loadout', loadout: { melee: 'espada-laser', ranged: 'bow', spear: 'si' } });
  assert.equal(a.loadout.melee, null);
  assert.equal(a.loadout.spear, false);
  sim.handle('A', { t: 'fire', o: ['x'], d: [NaN, 0, 1], p: 9 });
  sim.handle('A', { t: 'pose', h: [Infinity, 0, 0, 0, 0, 0, 1] });
});
test('limite de kills termina la partida y reinicia', () => {
  const { sim, a, b, evs } = duel();
  a.kills = 14;
  look(sim, 'A', 2, 1.65, 0);
  look(sim, 'B', 2, 1.65, -1);
  sim.handle('A', { t: 'select', slot: 'melee' });
  for (let i = 0; i < 6 && b.alive; i++) {
    sim.handle('A', { t: 'melee', o: [2, 1.5, 0], d: [0, 0, -1], v: 1.3 });
    run(sim, 1);
  }
  assert.equal(evs('match_end').length, 1);
  run(sim, 9);
  assert.equal(evs('match_start').length, 1);
  assert.equal(a.kills, 0);
});

console.log(`\n${passed} pruebas OK`);
