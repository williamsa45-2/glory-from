import * as THREE from 'three';
import { VRButton } from 'three/addons/VRButton.js';
import { createWorld } from './world.js';
import { createArena } from './arena.js';
import { Bow } from './bow.js';
import { loadWeaponModels } from './weaponModels.js';
import { GameAudio } from './audio.js';
import { GameSession } from './session.js';
import { LoopbackTransport, WsTransport } from './net.js';
import { Scoreboard, RING_STYLE, ARROWS_PER_END } from './scoreboard.js';
import { DesktopHud } from './hud.js';
import { DesktopControls } from './desktop.js';
import { VRControls } from './vr.js';
import { Sim } from '../shared/sim.js';
import { DECK, ARENA_MAP, TRAINING_MAP, TARGET_CENTER_Y } from '../shared/maps.js';
import { teamName, teamColor } from '../shared/teams.js';
import { WEAPONS, sanitizeLoadout, selectedWeapon, isThrowing } from '../shared/weapons.js';
import { solveElevation } from '../shared/physics.js';
import { pushOutOfBoxes, supportHeight } from '../shared/geometry.js';

const $ = (id) => document.getElementById(id);

// --- Ajustes guardados ---------------------------------------------------------------------
const defaults = { name: '', melee: 'sword', spear: false, ranged: 'bow', hand: 'right', roomName: '', roomKills: '15', roomMax: '8', roomVisibility: 'public', roomMode: 'ffa', roomSquads: '2' };
const settings = { ...defaults };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('archery-settings') ?? '{}'));
} catch {
  /* sin almacenamiento */
}
delete settings.server; // ajuste antiguo: ya no se elige servidor
const saveSettings = () => {
  try {
    localStorage.setItem('archery-settings', JSON.stringify(settings));
  } catch {
    /* sin almacenamiento */
  }
};
const loadout = () => sanitizeLoadout({ melee: settings.melee === 'none' ? null : settings.melee, spear: settings.spear, ranged: settings.ranged === 'none' ? null : settings.ranged });
const defaultServer = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// --- Renderer / escena ---------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1200);
const rig = new THREE.Group(); // "cuerpo" del jugador: se mueve/gira; la cámara y los mandos cuelgan de él
rig.add(camera);
scene.add(rig);

const audio = new GameAudio(camera, scene);
const hud = new DesktopHud($('hud'));
const game = { renderer, scene, camera, rig, audio, hud, settings };
window.game = game; // útil para depurar desde la consola

// --- Viento (solo entrenamiento) ---------------------------------------------------------------
const wind = {
  enabled: true, base: new THREE.Vector3(), target: new THREE.Vector3(), vec: new THREE.Vector3(), speed: 0, angle: 0,
};
function pickWind() {
  const speed = 0.5 + Math.random() * 6.5;
  const dir = Math.random() * Math.PI * 2;
  wind.target.set(Math.cos(dir) * speed, 0, Math.sin(dir) * speed);
}
function updateWind(dt, t) {
  wind.base.lerp(wind.target, 1 - Math.exp(-dt * 0.35));
  const gust = 1 + 0.22 * Math.sin(t * 0.9) + 0.12 * Math.sin(t * 2.3 + 1);
  wind.vec.copy(wind.base).multiplyScalar(wind.enabled ? gust : 0);
  wind.speed = wind.vec.length();
  wind.angle = Math.atan2(wind.vec.x, -wind.vec.z); // 0 = sopla hacia las dianas
}

// --- Arranque de cada modo ---------------------------------------------------------------------
let launched = false;
let mode = null;
let session = null;
let desktop = null;
let vr = null;
let world = null;
let sim = null;
let score = null;
let ladders = null;
let ladderOn = true;
const clock = new THREE.Clock();

function buildCollision() {
  if (mode === 'training') {
    return {
      apply(p) {
        p.x = THREE.MathUtils.clamp(p.x, DECK.xMin, DECK.xMax);
        p.z = THREE.MathUtils.clamp(p.z, DECK.zMin, DECK.zMax);
      },
      support: () => 0,
    };
  }
  const boxes = ARENA_MAP.boxes.map((b) => ({ min: new THREE.Vector3(...b.min), max: new THREE.Vector3(...b.max) }));
  const { min, max } = ARENA_MAP.bounds;
  return {
    /** Mantiene (x,z) dentro de la arena y fuera de los muros, según la altura de los pies. */
    apply(p, feetY = 0) {
      p.x = THREE.MathUtils.clamp(p.x, min[0], max[0]);
      p.z = THREE.MathUtils.clamp(p.z, min[1], max[1]);
      pushOutOfBoxes(p, 0.35, boxes, feetY);
    },
    /** Altura del suelo bajo (x,z): 0 o la cara superior de la caja que se pueda pisar. */
    support: (p, feetY = 0) => supportHeight(p, boxes, feetY),
  };
}

function buildLadders() {
  const dy = TARGET_CENTER_Y - 1.555;
  const out = {};
  for (const id of ['bow', 'crossbow', 'sling']) {
    const w = WEAPONS[id];
    out[id] = [10, 20, 30, 50, 70].map((distance) => ({
      distance,
      angle: solveElevation(w.projectile, distance, dy, w.speed) - Math.atan2(dy, distance),
    }));
  }
  return out;
}

async function launch(selectedMode, { serverUrl, room, create } = {}) {
  launchedOnce = true;
  await loadWeaponModels();
  mode = selectedMode;
  game.mode = mode;
  const bow = new Bow();
  game.bow = bow;
  game.collision = buildCollision();

  let transport;
  if (mode === 'training') {
    world = createWorld(scene, renderer);
    score = new Scoreboard();
    score.object3d.position.set(0, 0, -6);
    scene.add(score.object3d);
    ladders = buildLadders();
    pickWind();
    wind.base.copy(wind.target);
    rig.position.set(0, 0, 1.2);
    sim = new Sim({ map: TRAINING_MAP, mode: 'training' });
    transport = new LoopbackTransport(sim, { name: 'Tú', loadout: { ranged: 'bow' } });
    game.dummies = TRAINING_MAP.dummies;
  } else {
    world = createArena(scene, renderer);
    rig.position.set(0, 0, 0);
    transport = new WsTransport(serverUrl, { name: settings.name || `Arquero${Math.floor(Math.random() * 900 + 100)}`, loadout: loadout(), room, create });
    game.dummies = [];
  }
  game.world = world;

  const hooks = {
    toast: (t, seconds) => hud.toast(t, seconds),
    onSpawn: (pos, yaw) => (renderer.xr.isPresenting ? vr.teleport(pos, yaw) : desktop.teleport(pos, yaw)),
    onHurt: () => vr?.hurtPulse(),
    onDealt: () => vr?.dealtPulse(),
    onDummyHit: (id) => world.flashDummy?.(id),
    onScore: (m) => onScore(m),
    onTeam: (team) => {
      hud.toast(`Ahora estás en la escuadra ${teamName(team)}`);
      renderTeamPicker();
    },
  };
  session = new GameSession({ scene, audio, mode, transport, hooks });
  game.session = session;
  game.sim = sim;

  desktop = new DesktopControls(game);
  vr = new VRControls(game);
  game.desktop = desktop;
  game.vr = vr;

  if (mode === 'training') {
    Object.assign(game, {
      collect() {
        session.collect();
        pickWind();
        hud.toast('Flechas recogidas · el viento ha cambiado');
      },
      newGame() {
        score.reset();
        game.collect();
      },
      toggleWind() {
        wind.enabled = !wind.enabled;
        hud.toast(wind.enabled ? 'Viento activado' : 'Viento desactivado');
      },
      toggleLadder() {
        ladderOn = !ladderOn;
        hud.toast(ladderOn ? 'Escala de apuntado: sí' : 'Escala de apuntado: no');
      },
    });
  }

  if (transport.onclose !== undefined) {
    transport.onclose = () => {
      hud.toast('Conexión perdida con el servidor', 6);
      session.alive = false;
      showPause('Conexión perdida con el servidor. Vuelve al menú para reconectar.');
    };
  }
  await transport.start();
  if (transport.room) await showRoom({ ...transport.room, createdHere: !!create });
  launched = true;
  $('vr-slot').hidden = false;
  clock.start();
  renderer.setAnimationLoop(frame);
}

function onScore(m) {
  if (m.kind === 'target') {
    score.addShot({ ring: m.ring, label: m.label, distance: m.distance, kind: 'target' });
    const pos = new THREE.Vector3(...m.p).add(new THREE.Vector3(...m.n).multiplyScalar(0.3));
    pos.y += m.faceRadius + 0.15;
    session.effects.float(pos, m.label, { ring: RING_STYLE[m.ring], size: 0.3 + m.distance * 0.011, life: 2.2, rise: 0.35 });
    if (m.ring >= 10) audio.ding();
  } else {
    score.addShot({ ring: 0, label: 'M', distance: m.distance, kind: 'ground' });
    hud.toast('Fallaste: cayó al suelo');
  }
  if (score.end.length >= ARROWS_PER_END) pickWind();
}

// --- Bucle -------------------------------------------------------------------------------------
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const presenting = renderer.xr.isPresenting;

  if (mode === 'training') {
    updateWind(dt, t);
    sim.wind.set(wind.vec.x, 0, wind.vec.z);
  }
  if (presenting) vr.update(dt);
  else desktop.update(dt);
  session.update(dt);
  game.bow.update(dt);
  world.update(t, dt, wind, camera);
  if (mode === 'training') score.setWind(wind.speed, wind.angle);

  if (!presenting) {
    const sel = selectedWeapon(session.inv);
    const isRanged = sel && WEAPONS[sel].slot === 'ranged';
    hud.draw({
      dt,
      mode,
      session,
      draw: desktop.weapons.charge,
      fov: camera.fov,
      ladder: mode === 'training' && ladderOn && isRanged ? ladders[sel] : null,
      stats: score?.stats,
      wind,
      inv: session.inv,
      infinite: session.infinite,
      showScores: desktop.showScores,
      hint: desktop.hint,
      melee: !isRanged,
      throwMode: !!(sel && isThrowing(session.inv, sel)),
      latency: session.transport.latency ?? 0,
    });
  }
  renderer.render(scene, camera);
}

// --- Menú y pausa ----------------------------------------------------------------------------------
const menu = $('menu');
const pause = $('pause');

function showPause(text) {
  if (renderer.xr.isPresenting) return;
  pause.hidden = false;
  $('pause-title').textContent = text ? 'Aviso' : 'Pausa';
  $('pause-text').textContent = text ?? '';
  $('pvp-loadout').hidden = mode !== 'pvp';
  $('room-info').hidden = !(mode === 'pvp' && currentRoom);
  $('train-tips').hidden = mode !== 'training';
  renderTeamPicker();
}

/** Botones para cambiar de escuadra (solo en salas por escuadras). */
function renderTeamPicker() {
  const squads = mode === 'pvp' && session?.teams > 0;
  $('team-pick').hidden = !squads;
  if (!squads) return;
  const mine = session.myTeam;
  const counts = Array(session.teams).fill(0);
  for (const p of session.players.values()) if (p.team != null) counts[p.team]++;
  $('team-buttons').replaceChildren(
    ...counts.map((n, i) => {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = `${teamName(i)} (${n})`;
      b.style.background = teamColor(i);
      b.style.opacity = i === mine ? '1' : '0.55';
      b.style.outline = i === mine ? '3px solid #fff' : 'none';
      b.addEventListener('click', () => session.setTeam(i));
      return b;
    })
  );
}

function bindSelect(id, key, { checkbox = false, onChange } = {}) {
  const el = $(id);
  if (checkbox) el.checked = !!settings[key];
  else el.value = settings[key];
  el.addEventListener('change', () => {
    settings[key] = checkbox ? el.checked : el.value;
    saveSettings();
    onChange?.();
  });
}
const applyLoadout = () => {
  if (session && mode === 'pvp') {
    session.setLoadout(loadout());
    hud.toast('Armas cambiadas: se aplicarán al reaparecer');
  }
};
for (const prefix of ['lo', 'p']) {
  bindSelect(`${prefix}-melee`, 'melee', { onChange: () => syncSelects(prefix) || applyLoadout() });
  bindSelect(`${prefix}-spear`, 'spear', { checkbox: true, onChange: () => syncSelects(prefix) || applyLoadout() });
  bindSelect(`${prefix}-ranged`, 'ranged', { onChange: () => syncSelects(prefix) || applyLoadout() });
}
function syncSelects(from) {
  const to = from === 'lo' ? 'p' : 'lo';
  $(`${to}-melee`).value = settings.melee;
  $(`${to}-spear`).checked = !!settings.spear;
  $(`${to}-ranged`).value = settings.ranged;
}
bindSelect('hand', 'hand');
$('name').value = settings.name;
$('name').addEventListener('input', () => {
  settings.name = $('name').value.slice(0, 16);
  saveSettings();
});

const menuButtons = () => [$('btn-training'), $('btn-pvp'), $('btn-create'), $('btn-join')];

/** roomOpts: { room: 'CODE' } para unirse o { create: {...ajustes} } para crear una sala (solo PvP). */
async function start(selectedMode, roomOpts = {}) {
  audio.resume();
  $('menu-error').textContent = '';
  for (const b of menuButtons()) b.disabled = true;
  $('menu-status').textContent = selectedMode === 'pvp' ? (roomOpts.create ? 'Creando la sala…' : 'Conectando…') : 'Cargando…';
  try {
    await new Promise((r) => setTimeout(r, 30)); // deja pintar el estado
    await launch(selectedMode, { serverUrl: settings.server || defaultServer(), ...roomOpts });
  } catch (err) {
    console.error(err);
    $('menu-error').textContent = err.message || String(err);
    $('menu-status').textContent = '';
    for (const b of menuButtons()) b.disabled = false;
    // la escena ya se montó a medias: para poder reintentar limpio, se recarga conservando lo elegido
    if (launchedOnce) {
      $('menu-status').textContent = 'Recargando para que puedas reintentarlo…';
      setTimeout(() => location.reload(), 2500);
    }
    return;
  }
  menu.hidden = true;
  if (currentRoom?.created) showPause(); // quien crea la sala ve primero el código para invitar
  else desktop.requestLock();
}
$('btn-training').addEventListener('click', () => start('training'));

// --- Salas PvP ---------------------------------------------------------------------------------
let currentRoom = null;
let launchedOnce = false;
/** URL http(s) del servidor de juego cuando se usa uno distinto de esta página (campo «Servidor»). */
function apiBase() {
  if (!settings.server) return '';
  try {
    const u = new URL(settings.server);
    return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
  } catch {
    return '';
  }
}
/**
 * Direcciones con las que otros pueden abrir este juego. Si juegas en localhost, tu amigo necesita la IP de
 * tu PC en la red local (el servidor las da ordenadas, la más probable primero).
 */
async function inviteOrigins() {
  const base = apiBase();
  if (base) return [{ origin: base, label: base }];
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!local) return [{ origin: location.origin, label: location.host }];
  try {
    const info = await (await fetch('/api/info')).json();
    const scheme = info.https ? 'https' : 'http';
    const list = (info.lan ?? []).map((i) => ({ origin: `${scheme}://${i.address}:${info.port}`, label: `${i.name} — ${i.address}` }));
    if (list.length) return list;
  } catch {
    /* sin info */
  }
  return [{ origin: location.origin, label: 'solo este equipo', onlyLocal: true }];
}
function inviteLink(origin, code) {
  const url = new URL(apiBase() ? '/' : location.pathname, origin);
  url.searchParams.set('sala', code);
  return url.href;
}
async function showRoom(room) {
  currentRoom = { ...room, created: !!room.createdHere };
  $('room-info-name').textContent = `«${room.name}»`;
  $('room-info-code').textContent = room.code;
  const origins = await inviteOrigins();
  const onlyLocal = !!origins[0].onlyLocal;
  const pick = $('room-ip');
  pick.replaceChildren(...origins.map((o, i) => new Option(o.label, String(i))));
  pick.hidden = origins.length < 2; // con varias redes (Wi-Fi, zona compartida, VPN…) se puede elegir
  const update = () => ($('room-link').value = inviteLink(origins[Number(pick.value) || 0].origin, room.code));
  pick.onchange = update;
  update();
  $('room-info-note').textContent = onlyLocal
    ? 'No se encontró la IP de este PC en la red local: el enlace solo sirve aquí. Comprueba que estás conectado a la red.'
    : `Pásale el enlace o el código ${room.code} ${['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? ' (debe estar en tu misma red Wi-Fi)' : ''}. ${room.teams ? `Gana ${room.mode === 'duos' ? 'la pareja' : 'la escuadra'} que sume ${room.killLimit} bajas` : `Gana quien llegue a ${room.killLimit} bajas`} · máximo ${room.max} jugadores.`;
  hud.toast(`Sala ${room.code} · Esc para ver el código y el enlace de invitación`, 6);
}
$('btn-copy').addEventListener('click', async () => {
  const link = $('room-link');
  try {
    await navigator.clipboard.writeText(link.value);
  } catch {
    link.select();
    document.execCommand?.('copy');
  }
  $('btn-copy').textContent = '¡Copiado!';
  setTimeout(() => ($('btn-copy').textContent = 'Copiar enlace'), 1500);
});

async function refreshRooms() {
  const list = $('room-list');
  const note = (text) => {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    list.replaceChildren(li);
  };
  try {
    const { rooms } = await (await fetch(`${apiBase()}/api/rooms`)).json();
    if (!rooms.length) return note('No hay salas públicas. ¡Crea una!');
    list.replaceChildren();
    for (const r of rooms) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.textContent = `${r.name} · ${r.players}/${r.max} · ${{ squads: `${r.teams} escuadras`, duos: 'dúos' }[r.mode] ?? 'todos vs todos'} · ${r.killLimit} bajas · `;
      const code = document.createElement('b');
      code.textContent = r.code;
      info.append(code);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      const full = r.players >= r.max;
      btn.textContent = full ? 'Llena' : 'Unirse';
      btn.disabled = full;
      btn.addEventListener('click', () => start('pvp', { room: r.code }));
      li.append(info, btn);
      list.append(li);
    }
  } catch {
    note('No se pudo consultar el servidor.');
  }
  return undefined;
}
$('btn-pvp').addEventListener('click', () => {
  const panel = $('pvp-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    refreshRooms();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
$('btn-refresh').addEventListener('click', refreshRooms);
bindSelect('room-kills', 'roomKills');
bindSelect('room-max', 'roomMax');
bindSelect('room-public', 'roomVisibility');
const syncRoomMode = () => {
  const squads = settings.roomMode === 'squads';
  $('room-squads').hidden = !squads;
  $('room-squads-label').hidden = !squads;
};
bindSelect('room-mode', 'roomMode', { onChange: syncRoomMode });
bindSelect('room-squads', 'roomSquads');
syncRoomMode();
$('room-name').value = settings.roomName;
$('room-name').placeholder = `Sala de ${settings.name || 'Arquero'}`;
$('room-name').addEventListener('input', () => {
  settings.roomName = $('room-name').value.slice(0, 24);
  saveSettings();
});
$('btn-create').addEventListener('click', () =>
  start('pvp', {
    create: {
      name: settings.roomName || `Sala de ${settings.name || 'Arquero'}`,
      killLimit: Number(settings.roomKills),
      maxPlayers: Number(settings.roomMax),
      public: settings.roomVisibility !== 'private',
      mode: settings.roomMode,
      teams: settings.roomMode === 'squads' ? Number(settings.roomSquads) : 0,
    },
  })
);
const joinByCode = () => {
  const code = $('room-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) {
    $('menu-error').textContent = 'Escribe el código de la sala (4 letras/números).';
    $('room-code').focus();
    return;
  }
  start('pvp', { room: code });
};
$('btn-join').addEventListener('click', joinByCode);
$('room-code').addEventListener('keydown', (e) => e.key === 'Enter' && joinByCode());
$('btn-menu').addEventListener('click', () => location.reload());
$('play').addEventListener('click', () => {
  audio.resume();
  desktop.requestLock();
});

game.onLockChange = (locked) => {
  if (locked) pause.hidden = true;
  else if (launched) showPause();
};
document.addEventListener('pointerlockerror', () => launched && showPause());

// WebXR: botón de entrada a VR
$('vr-slot').appendChild(VRButton.createButton(renderer));

renderer.xr.addEventListener('sessionstart', () => {
  audio.resume();
  if (document.pointerLockElement) document.exitPointerLock();
  menu.hidden = true;
  pause.hidden = true;
  hud.clear();
  vr.begin();
});
renderer.xr.addEventListener('sessionend', () => {
  vr.end();
  desktop.resetView();
  showPause();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  hud.resize();
});

// ?sala=CODE (enlace de invitación) abre el panel PvP con el código puesto.
// ?autostart=training|pvp  (&server=ws://…) arranca directamente; útil para pruebas
const params = new URLSearchParams(location.search);
if (params.get('server')) settings.server = params.get('server'); // solo pruebas: el juego usa siempre el servidor que sirve la página
if (params.get('name')) settings.name = params.get('name');
if (params.get('sala')) {
  $('pvp-panel').hidden = false;
  $('room-code').value = params.get('sala').toUpperCase().slice(0, 8);
  $('menu-status').textContent = `Te han invitado a la sala ${$('room-code').value}: elige tus armas y pulsa «Unirse».`;
  refreshRooms();
}
if (params.get('autostart')) start(params.get('autostart') === 'pvp' ? 'pvp' : 'training', params.get('sala') ? { room: params.get('sala') } : {});
