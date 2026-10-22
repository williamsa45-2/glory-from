// Prueba de integración: arranca el servidor real y conecta dos bots por WebSocket.
//   node server/bots.test.mjs
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 8123;
const server = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

function bot(name, loadout) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { ws, id: null, got: [], snaps: 0 };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'snap') b.snaps++;
    else b.got.push(m);
    if (m.t === 'welcome') b.id = m.id;
  });
  b.send = (m) => ws.send(JSON.stringify(m));
  b.opened = new Promise((r) => ws.on('open', r));
  b.opened.then(() => b.send({ t: 'join', name, loadout }));
  return b;
}
const ev = (b, t) => b.got.filter((m) => m.t === t);

try {
  const status = await (await fetch(`http://localhost:${PORT}/api/status`)).json();
  assert.equal(status.players, 0);
  assert.equal((await fetch(`http://localhost:${PORT}/server/net.js`)).status, 404, 'el código del servidor no se sirve');
  assert.equal((await fetch(`http://localhost:${PORT}/shared/sim.js`)).status, 200);

  // compresión y caché
  const gz = await fetch(`http://localhost:${PORT}/vendor/three.module.min.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  assert.ok(Number(gz.headers.get('content-length') ?? 1) > 0);
  const etag = gz.headers.get('etag');
  const again = await fetch(`http://localhost:${PORT}/vendor/three.module.min.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304, 'ETag → 304');
  assert.equal((await fetch(`http://localhost:${PORT}/package.json`)).status, 404, 'package.json no se sirve');
  assert.equal((await fetch(`http://localhost:${PORT}/assets/models/sword.glb`)).status, 200);

  // otro origen: rechazado
  const evil = new WebSocket(`ws://localhost:${PORT}/ws`, { headers: { Origin: 'http://evil.example' } });
  const code = await new Promise((r) => { evil.on('close', (c) => r(c)); evil.on('error', () => {}); });
  assert.equal(code, 4403, 'origen ajeno rechazado');

  // límite por IP (4)
  const extra = [];
  for (let i = 0; i < 5; i++) extra.push(new WebSocket(`ws://localhost:${PORT}/ws`));
  const closed = await Promise.all(extra.map((w) => new Promise((r) => { w.on('close', (c) => r(c)); setTimeout(() => r(null), 800); w.on('error', () => {}); })));
  assert.equal(closed.filter((c) => c === 4002).length, 1, 'la 5.ª conexión de la misma IP se rechaza: ' + JSON.stringify(closed));
  extra.forEach((w) => w.close());
  await sleep(400);

  const A = bot('Ana', { melee: 'sword', ranged: 'bow' });
  const B = bot('Beto', { melee: 'axe', ranged: 'sling', spear: true });
  await Promise.all([A.opened, B.opened]);
  await sleep(500);
  assert.ok(A.id && B.id, 'welcome recibido');
  assert.equal(ev(A, 'welcome')[0].mode, 'pvp');
  assert.ok(ev(A, 'welcome')[0].items.length > 20, 'items del mapa');
  assert.equal(ev(B, 'inv').at(-1).inv.ranged, 'sling');
  assert.equal(ev(B, 'inv').at(-1).inv.ammo, 1);

  // colocarlos frente a frente en una línea despejada
  A.send({ t: 'pose', h: [2, 1.65, -12, 0, 0, 0, 1], w: 'bow', wp: [0, 0, 0, 0, 0, 0, 1], a: 0 });
  B.send({ t: 'pose', h: [2, 1.65, 8, 0, 0, 0, 1], w: 'sling', wp: [0, 0, 0, 0, 0, 0, 1], a: 0 });
  await sleep(300);
  const sp = ev(A, 'spawn').find((s) => s.id === A.id);
  assert.ok(sp);
  // la posición de reaparición la manda el servidor: el cliente real se coloca ahí. Aquí forzamos nueva pose.
  await sleep(100);
  assert.ok(A.snaps > 3, 'recibe snapshots (' + A.snaps + ')');

  // disparo: ángulo pequeño hacia B
  A.send({ t: 'fire', o: [2, 1.65, -12], d: [0, 0.035, 1], p: 1 });
  await sleep(2500);
  const proj = ev(B, 'proj');
  assert.equal(proj.length, 1, 'B ve el proyectil de A');
  console.log('proj', proj[0].type, 'hits:', ev(B, 'hit').length, 'ends:', ev(A, 'proj_end').map((e) => e.kind));
  assert.ok(ev(A, 'proj_end').length === 1);

  // regla de inventario por red: B (hacha+honda+lanza) intenta recoger una espada de un spawner
  const sword = ev(B, 'welcome')[0].items.find((i) => i.type === 'sword');
  B.send({ t: 'pose', h: [...sword.pos.slice(0, 1), 1.65, sword.pos[2], 0, 0, 0, 1] });
  await sleep(250);
  B.send({ t: 'pickup', id: sword.id });
  await sleep(300);
  assert.ok(ev(B, 'msg').some((m) => /No puedes llevar espada y hacha/.test(m.text)), 'mensaje de exclusión: ' + JSON.stringify(ev(B, 'msg')));

  // desconexión limpia
  A.ws.close();
  await sleep(300);
  assert.ok(ev(B, 'leave').some((m) => m.id === A.id));
  const st = await (await fetch(`http://localhost:${PORT}/api/status`)).json();
  assert.equal(st.players, 1);
  B.ws.close();
  await sleep(300);

  // ---- salas: crear con ajustes, unirse con el código, código inexistente, sala llena
  const roomBot = (name, extra) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const r = { ws, got: [], closeCode: null };
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t !== 'snap') r.got.push(m);
    });
    ws.on('close', (c) => (r.closeCode = c));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, loadout: { melee: 'sword' }, ...extra })));
    return r;
  };
  const H = roomBot('Host', { create: { name: 'Duelo de prueba', killLimit: 5, maxPlayers: 2, public: false } });
  await sleep(500);
  const created = H.got.find((m) => m.t === 'room');
  assert.ok(created && /^[A-Z0-9]{4}$/.test(created.code), 'la sala nueva tiene código: ' + JSON.stringify(created));
  assert.equal(created.killLimit, 5);
  assert.equal(H.got.find((m) => m.t === 'welcome').killLimit, 5, 'la sala usa sus bajas para ganar');
  const listed = (await (await fetch(`http://localhost:${PORT}/api/rooms`)).json()).rooms;
  assert.ok(!listed.some((r) => r.code === created.code), 'una sala privada no sale en la lista');
  assert.ok(listed.some((r) => r.code === 'PUBLICA'), 'la sala pública siempre está');

  const G = roomBot('Guest', { room: created.code.toLowerCase() });
  await sleep(500);
  assert.equal(G.got.find((m) => m.t === 'room')?.code, created.code, 'se une con el código (sin importar mayúsculas)');
  assert.ok(H.got.some((m) => m.t === 'join' && m.name === 'Guest'), 'el anfitrión ve entrar al invitado');

  const X = roomBot('Tarde', { room: created.code });
  await sleep(500);
  assert.ok(X.got.some((m) => m.t === 'full') && X.closeCode === 4001, 'sala de 2 llena');
  const N = roomBot('Perdido', { room: 'ZZZZ' });
  await sleep(500);
  assert.ok(N.got.some((m) => m.t === 'no_room') && N.closeCode === 4004, 'código inexistente');
  const info = await (await fetch(`http://localhost:${PORT}/api/info`)).json();
  assert.ok(Array.isArray(info.lanIps) && info.port === PORT, '/api/info para el enlace de invitación');
  H.ws.close();
  G.ws.close();
  console.log('\nIntegración OK');
} finally {
  server.kill();
}
