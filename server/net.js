// Servidor de juego PvP por WebSocket (/ws). Varias salas a la vez, cada una con su código y su propia
// simulación autoritativa. Siempre existe una sala pública por defecto (PUBLICA) para quien entra sin código.
import { WebSocketServer } from 'ws';
import { Sim } from '../shared/sim.js';
import { MAPS } from '../shared/maps.js';
import { MAX_TEAMS, MAX_SQUADS } from '../shared/teams.js';

export const PROTOCOL = 2;
const TICK_MS = 1000 / 60;
const SNAPSHOT_EVERY = 3; // 20 Hz
const MAX_MSGS_PER_SEC = 200;
const DEFAULT_ROOM = 'PUBLICA';
const MAX_ROOMS = 20;
const EMPTY_ROOM_TTL = 60_000; // ms que sobrevive una sala vacía (por si el anfitrión recarga la página)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L, para dictarlo sin líos
const KILL_LIMITS = [5, 10, 15, 25, 50];

/** Ajustes de sala que llegan del cliente: se valida todo. */
export function sanitizeRoomSettings(s = {}, maxPlayers = 12) {
  const name = typeof s?.name === 'string' ? s.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) : '';
  const max = Math.round(Number(s?.maxPlayers));
  const kills = Math.round(Number(s?.killLimit));
  const squads = Math.round(Number(s?.teams));
  let players = Number.isFinite(max) ? Math.min(maxPlayers, Math.max(2, max)) : maxPlayers;
  // ffa = todos contra todos · squads = 2–4 escuadras · duos = parejas fijas (jugadores pares, ≥ 4)
  const mode = s?.mode === 'duos' ? 'duos' : s?.mode === 'squads' || squads >= 2 ? 'squads' : 'ffa';
  let teams = 0;
  let maxPerTeam = Infinity;
  if (mode === 'duos') {
    players = Math.min(MAX_TEAMS * 2, Math.max(4, players - (players % 2)));
    teams = players / 2;
    maxPerTeam = 2;
  } else if (mode === 'squads') {
    teams = Math.min(Math.max(2, squads || 2), MAX_SQUADS, players);
    maxPerTeam = Math.ceil(players / teams);
  }
  return {
    name: name || 'Sala',
    maxPlayers: players,
    killLimit: KILL_LIMITS.includes(kills) ? kills : 15,
    public: s?.public !== false,
    mode: teams ? mode : 'ffa',
    teams,
    maxPerTeam,
  };
}

const normCode = (c) => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '');

export function attachGameServer(httpServer, { maxPlayers = 12, maxPerIp = 4, trustProxy = false, allowedOrigins = [], log = console.log } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024 });
  // ws reenvía los errores de listen() del servidor HTTP; los gestiona server.mjs (reintento de puerto)
  wss.on('error', () => {});
  const rooms = new Map(); // código -> sala
  const perIp = new Map(); // ip -> nº de conexiones
  let counter = 0;

  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || '?';
  /** Solo se admiten orígenes del propio host (o los listados): evita que otras webs usen tu servidor. */
  const originOk = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // clientes que no son navegador (bots de prueba)
    try {
      const o = new URL(origin);
      return o.host === req.headers.host || allowedOrigins.includes(o.origin) || allowedOrigins.includes(o.host);
    } catch {
      return false;
    }
  };

  const send = (ws, text) => {
    if (ws.readyState === 1) ws.send(text);
  };

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  function createRoom(code, settings, { permanent = false } = {}) {
    const sockets = new Map(); // id jugador -> ws
    const room = {
      code, settings, sockets, permanent, emptySince: Date.now(), tick: 0,
      sim: new Sim({
        map: MAPS.arena,
        mode: 'pvp',
        killLimit: settings.killLimit,
        teams: settings.teams,
        maxPerTeam: settings.maxPerTeam,
        emit(msg, to) {
          const text = JSON.stringify(msg);
          if (to === undefined) for (const ws of sockets.values()) send(ws, text);
          else for (const id of [].concat(to)) {
            const ws = sockets.get(id);
            if (ws) send(ws, text);
          }
        },
      }),
    };
    rooms.set(code, room);
    return room;
  }

  const publicInfo = (r) => ({
    code: r.code, name: r.settings.name, players: r.sockets.size, max: r.settings.maxPlayers, killLimit: r.settings.killLimit, teams: r.settings.teams, mode: r.settings.mode,
  });

  createRoom(DEFAULT_ROOM, { name: 'Arena pública', maxPlayers, killLimit: 15, public: true, teams: 0, mode: 'ffa', maxPerTeam: Infinity }, { permanent: true });

  let last = performance.now();
  const loop = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const room of rooms.values()) {
      if (!room.sockets.size) {
        if (!room.permanent && Date.now() - room.emptySince > EMPTY_ROOM_TTL) {
          rooms.delete(room.code);
          log(`sala ${room.code} cerrada (vacía)`);
        }
        continue;
      }
      room.sim.update(dt);
      if (++room.tick % SNAPSHOT_EVERY === 0) {
        const text = JSON.stringify(room.sim.snapshot());
        for (const ws of room.sockets.values()) send(ws, text);
      }
    }
  }, TICK_MS);
  loop.unref?.();

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    if (!originOk(req)) return ws.close(4403, 'origin');
    if ((perIp.get(ip) ?? 0) >= maxPerIp) return ws.close(4002, 'too many connections');
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    ws.on('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
    });
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    let id = null;
    let room = null;
    let windowStart = Date.now();
    let count = 0;
    const joinTimer = setTimeout(() => !id && ws.close(4000, 'join timeout'), 10000);
    const refuse = (t, code, reason) => {
      send(ws, JSON.stringify({ t }));
      ws.close(code, reason);
    };

    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_MSGS_PER_SEC) return ws.close(4003, 'rate limit');
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return undefined;
      }
      if (!msg || typeof msg.t !== 'string') return undefined;

      if (!id) {
        if (msg.t !== 'join') return undefined;
        // {create: {...ajustes}} crea una sala nueva; {room: 'CODE'} entra en una; sin nada, la pública
        if (msg.create) {
          if (rooms.size >= MAX_ROOMS) return refuse('too_many_rooms', 4005, 'too many rooms');
          room = createRoom(newCode(), sanitizeRoomSettings(msg.create, maxPlayers));
          log(`sala ${room.code} creada: «${room.settings.name}» (${room.settings.maxPlayers} jug., ${room.settings.killLimit} bajas, ${{ ffa: 'todos contra todos', squads: room.settings.teams + ' escuadras', duos: 'dúos' }[room.settings.mode]})`);
        } else {
          room = rooms.get(normCode(msg.room) || DEFAULT_ROOM);
          if (!room) return refuse('no_room', 4004, 'no room');
        }
        if (room.sockets.size >= room.settings.maxPlayers) return refuse('full', 4001, 'full');
        id = `p${++counter}`;
        room.sockets.set(id, ws);
        clearTimeout(joinTimer);
        log(`+ ${id} (${String(msg.name).slice(0, 16)}) desde ${ip} en ${room.code} — ${room.sockets.size} jugadores`);
        send(ws, JSON.stringify({ t: 'room', ...publicInfo(room), public: room.settings.public }));
        room.sim.addPlayer(id, { name: msg.name, loadout: msg.loadout });
        room.sim.sendScores();
        return undefined;
      }
      if (msg.t === 'ping') return send(ws, JSON.stringify({ t: 'pong', c: msg.c }));
      room.sim.handle(id, msg);
      return undefined;
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (id && room) {
        room.sockets.delete(id);
        room.sim.removePlayer(id);
        if (!room.sockets.size) room.emptySince = Date.now();
        log(`- ${id} de ${room.code} — ${room.sockets.size} jugadores`);
      }
    });
    ws.on('error', () => {});
  });

  // elimina conexiones muertas
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000).unref?.();

  const totalPlayers = () => [...rooms.values()].reduce((n, r) => n + r.sockets.size, 0);
  let closed = false;
  return {
    rooms,
    get sim() {
      return rooms.get(DEFAULT_ROOM).sim;
    },
    wss,
    status: () => ({ ok: true, players: totalPlayers(), rooms: rooms.size, max: maxPlayers, map: 'arena', uptime: Math.round(process.uptime()) }),
    /** Salas públicas para el menú (las privadas solo se encuentran con el código). */
    listRooms: () => [...rooms.values()].filter((r) => r.settings.public).map(publicInfo),
    close() {
      if (closed) return;
      closed = true;
      for (const ws of wss.clients) ws.close(1001, 'server shutdown');
    },
  };
}
