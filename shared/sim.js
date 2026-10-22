// Simulación autoritativa del juego. No toca el DOM ni la red: el servidor (PvP) y el navegador
// (entrenamiento, con transporte "en bucle") ejecutan exactamente este mismo código.
import * as THREE from 'three';
import {
  WEAPONS, PROJECTILES, PLAYER_HP, HEADSHOT_MULT, AMMO_ITEMS,
  makeInventory, sanitizeLoadout, selectedWeapon, primaryAction, canMelee, toggleThrowMode, cycleSelected,
  pickBlockReason, giveWeapon, takeWeapon, ammoFits, addAmmo, weaponInSlot, SLOTS, ensureSelected,
} from './weapons.js';
import { stepProjectile, scoreHit, FIXED_DT } from './physics.js';
import { segAABB, segCapsule, segSphere } from './geometry.js';
import { teamName } from './teams.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const finite3 = (a) => Array.isArray(a) && a.length >= 3 && a[0] === +a[0] && a[1] === +a[1] && a[2] === +a[2] && Math.abs(a[0]) < 1e4 && Math.abs(a[1]) < 1e4 && Math.abs(a[2]) < 1e4;
const round = (n, k = 1000) => Math.round(n * k) / k;
const r3 = (v) => [round(v.x), round(v.y), round(v.z)];

const HEAD_R = 0.17;
const BODY_R = 0.3;
const PICKUP_R = 1.3;
const FORWARD = new THREE.Vector3(0, 0, -1);
const EYE_HEIGHT = 1.65;
/** Cápsula del cuerpo de un jugador: de los pies (según la altura de la cabeza) hasta bajo la cabeza. */
function bodyCapsule(q) {
  const feet = Math.max(0, q.head.y - EYE_HEIGHT);
  return [new THREE.Vector3(q.head.x, feet + 0.3, q.head.z), new THREE.Vector3(q.head.x, q.head.y - 0.28, q.head.z)];
}
const KILL_LIMIT = 15;
const RESPAWN_TIME = 4;
const MAX_ITEMS = 220;
const TEAM_SWITCH_COOLDOWN = 5; // s entre cambios de escuadra

function yawQuat(yaw) {
  return [0, round(Math.sin(yaw / 2)), 0, round(Math.cos(yaw / 2))];
}

const _q = new THREE.Quaternion();
function dirQuat(dir) {
  _q.setFromUnitVectors(FORWARD, dir);
  return [round(_q.x), round(_q.y), round(_q.z), round(_q.w)];
}

export function publicInventory(inv) {
  return {
    melee: inv.melee, spear: inv.spear, ranged: inv.ranged, ammo: inv.ammo, selected: inv.selected,
    throwMode: { axe: inv.throwMode.axe, spear: inv.throwMode.spear },
  };
}

export class Sim {
  /**
   * @param {object} o
   * @param {object} o.map      uno de MAPS
   * @param {'pvp'|'training'} o.mode
   * @param {(msg:object, to?:string|string[])=>void} o.emit  entrega mensajes (a todos o a un jugador)
   * @param {number} o.teams        0 = todos contra todos; 2–4 = escuadras (sin fuego amigo; cuentan las bajas del equipo)
   * @param {number} o.maxPerTeam   tamaño máximo de cada escuadra (para cambiar de equipo)
   */
  constructor({ map, mode = 'pvp', emit = () => {}, killLimit = KILL_LIMIT, teams = 0, maxPerTeam = Infinity }) {
    this.killLimit = killLimit; // bajas para ganar la partida (cada sala elige el suyo)
    this.teams = teams;
    this.maxPerTeam = maxPerTeam;
    this.teamKills = Array(teams).fill(0);
    this.map = map;
    this.mode = mode;
    this.emit = emit;
    this.infinite = mode === 'training';
    this.players = new Map();
    this.projectiles = [];
    this.items = new Map();
    this.timers = [];
    this.time = 0;
    this.acc = 0;
    this.nextId = 1;
    this.wind = new THREE.Vector3();
    this.boxes = (map.boxes ?? []).map((b) => ({ min: V(b.min), max: V(b.max) }));
    this.targets = (map.targets ?? []).map((t) => ({ ...t, centerV: V(t.center), normalV: V(t.normal) }));
    this.dummies = (map.dummies ?? []).map((d, i) => ({ id: `d${i}`, pos: V([d.x, 0, d.z]), hp: 100 }));
    this.matchResetAt = 0;
    this.winner = null;
    this.resetItems();
  }

  // ---------------------------------------------------------------- items
  resetItems() {
    for (const id of [...this.items.keys()]) this.removeItem(id);
    this.timers.length = 0;
    (this.map.items ?? []).forEach((def, index) => this.spawnMapItem(def, index));
  }

  spawnMapItem(def, index) {
    return this.addItem({
      type: def.type,
      count: def.count ?? 1,
      pos: def.pos,
      quat: yawQuat(def.yaw ?? (index * 1.7) % 6.28),
      rack: !!def.rack,
      spawner: index,
    });
  }

  addItem({ type, count = 1, pos, quat = [0, 0, 0, 1], stuck = false, ttl = null, rack = false, spawner = null }) {
    const item = {
      id: this.nextId++, type, count, pos: [round(pos[0]), round(pos[1]), round(pos[2])], quat, stuck, rack, spawner,
      expires: ttl ? this.time + ttl : null,
    };
    this.items.set(item.id, item);
    this.emit({ t: 'item_add', item: this.publicItem(item) });
    if (this.items.size > MAX_ITEMS) {
      for (const [id, it] of this.items) {
        if (it.spawner == null && !it.rack) {
          this.removeItem(id);
          break;
        }
      }
    }
    return item;
  }

  publicItem(it) {
    return { id: it.id, type: it.type, count: it.count, pos: it.pos, quat: it.quat, stuck: it.stuck, rack: it.rack };
  }

  removeItem(id, notify = true) {
    const it = this.items.get(id);
    if (!it) return null;
    this.items.delete(id);
    if (notify) this.emit({ t: 'item_remove', id });
    return it;
  }

  /** Tras recoger un objeto de un punto fijo, vuelve a aparecer pasado un tiempo. */
  scheduleRespawn(it) {
    if (it.spawner == null) return;
    const def = this.map.items[it.spawner];
    const delay = it.rack ? 0.4 : def.every ?? 0;
    if (!delay) return;
    this.timers.push({ at: this.time + delay, fn: () => this.spawnMapItem(def, it.spawner) });
  }

  // ---------------------------------------------------------------- jugadores
  addPlayer(id, { name = 'Jugador', loadout } = {}) {
    const p = {
      id, name: String(name).slice(0, 16) || 'Jugador', team: this.teams ? this.smallestTeam() : null, teamAt: -Infinity, alive: false, hp: PLAYER_HP, kills: 0, deaths: 0,
      loadout: sanitizeLoadout(loadout ?? (this.mode === 'training' ? { ranged: 'bow' } : { melee: 'sword', ranged: 'bow' })),
      inv: makeInventory({}, { infinite: this.infinite }), cdUntil: {}, respawnAt: 0, lastPoseAt: 0,
      head: new THREE.Vector3(0, 1.65, 0),
      pose: { h: [0, 1.65, 0, 0, 0, 0, 1], w: null, wp: [0, 0, 0, 0, 0, 0, 1], a: 0, lh: [0, 1, 0], rh: [0, 1, 0] },
    };
    this.players.set(id, p);
    this.emit({
      t: 'welcome', id, mode: this.mode, map: this.map.id, killLimit: this.killLimit, infinite: this.infinite,
      teams: this.teams, teamKills: this.teamKills,
      players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, k: q.kills, d: q.deaths, team: q.team })),
      items: [...this.items.values()].map((i) => this.publicItem(i)),
    }, id);
    this.emit({ t: 'join', id, name: p.name, team: p.team });
    this.spawn(p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) this.dropAll(p);
    this.players.delete(id);
    this.emit({ t: 'leave', id });
    this.sendScores();
  }

  spawn(p) {
    const spawns = this.map.spawns;
    let best = spawns[0];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const o of this.players.values()) {
        if (o !== p && o.alive && !this.allies(o, p)) d = Math.min(d, Math.hypot(o.head.x - s.x, o.head.z - s.z));
      }
      if (d === Infinity) d = Math.random() * 10; // sin rivales: al azar
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    p.alive = true;
    p.hp = PLAYER_HP;
    p.inv = makeInventory(p.loadout, { infinite: this.infinite });
    p.cdUntil = {};
    p.head.set(best.x, 1.65, best.z);
    p.pose.h = [best.x, 1.65, best.z, ...yawQuat(best.yaw ?? 0).slice(0, 4)];
    p.lastPoseAt = 0;
    this.emit({ t: 'spawn', id: p.id, pos: [best.x, 0, best.z], yaw: best.yaw ?? 0 });
    this.sendInv(p);
  }

  sendInv(p) {
    ensureSelected(p.inv);
    this.emit({ t: 'inv', inv: publicInventory(p.inv), inf: this.infinite }, p.id);
  }

  sendScores() {
    this.emit({
      t: 'scores',
      list: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, k: p.kills, d: p.deaths, team: p.team })),
      tk: this.teamKills,
    });
  }

  // ---------------------------------------------------------------- escuadras
  /** Compañeros: sala por escuadras y mismo equipo (no hay fuego amigo). */
  allies(a, b) {
    return this.teams > 0 && a.team === b.team;
  }

  teamSize(team) {
    let n = 0;
    for (const q of this.players.values()) if (q.team === team) n++;
    return n;
  }

  smallestTeam() {
    let best = 0;
    for (let i = 1; i < this.teams; i++) if (this.teamSize(i) < this.teamSize(best)) best = i;
    return best;
  }

  /** Cambio de escuadra a petición del jugador: limitado por el tamaño de la escuadra y un tiempo de espera. */
  setTeam(p, team) {
    if (!this.teams || !Number.isInteger(team) || team < 0 || team >= this.teams || team === p.team) return undefined;
    if (this.time - p.teamAt < TEAM_SWITCH_COOLDOWN) return this.notify(p, 'Espera unos segundos para volver a cambiar de escuadra');
    if (this.teamSize(team) >= this.maxPerTeam) return this.notify(p, `La escuadra ${teamName(team)} está completa`);
    p.team = team;
    p.teamAt = this.time;
    if (p.alive) this.dropAll(p);
    this.emit({ t: 'team', id: p.id, team });
    this.sendScores();
    if (p.alive && !this.winner) this.spawn(p);
    return undefined;
  }

  notify(p, text) {
    this.emit({ t: 'msg', text }, p.id);
  }

  // ---------------------------------------------------------------- mensajes de cliente
  handle(id, m) {
    const p = this.players.get(id);
    if (!p || !m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'pose': return this.onPose(p, m);
      case 'fire': return this.onFire(p, m);
      case 'throw': return this.onThrow(p, m);
      case 'melee': return this.onMelee(p, m);
      case 'select': {
        if (SLOTS.includes(m.slot) && weaponInSlot(p.inv, m.slot)) p.inv.selected = m.slot;
        else if (m.cycle) cycleSelected(p.inv, m.cycle > 0 ? 1 : -1);
        return this.sendInv(p);
      }
      case 'mode':
        if (toggleThrowMode(p.inv)) this.sendInv(p);
        return undefined;
      case 'drop': return this.onDrop(p);
      case 'pickup': return this.onPickup(p, m.id);
      case 'loadout':
        p.loadout = sanitizeLoadout(m.loadout);
        if (this.mode === 'training') {
          p.inv = makeInventory(p.loadout, { infinite: true });
          this.sendInv(p);
        }
        return undefined;
      case 'collect': return this.mode === 'training' ? this.collect(p) : undefined;
      case 'wind':
        if (this.mode === 'training' && finite3(m.v)) this.wind.set(m.v[0], 0, m.v[2]);
        return undefined;
      case 'team': return this.setTeam(p, m.team);
      case 'name':
        p.name = String(m.name ?? '').slice(0, 16) || p.name;
        return this.sendScores();
      default:
        return undefined;
    }
  }

  onPose(p, m) {
    if (!p.alive || !Array.isArray(m.h) || m.h.length < 7 || !m.h.every(Number.isFinite)) return;
    const h = m.h.slice(0, 7);
    const b = this.map.bounds;
    if (b) {
      h[0] = THREE.MathUtils.clamp(h[0], b.min[0], b.max[0]);
      h[2] = THREE.MathUtils.clamp(h[2], b.min[1], b.max[1]);
    }
    h[1] = THREE.MathUtils.clamp(h[1], 0.3, 5);
    const now = performance.now() / 1000;
    if (this.mode === 'pvp' && p.lastPoseAt) {
      // límite de velocidad: evita teletransportes
      const dt = Math.max(0.03, now - p.lastPoseAt);
      const max = 16 * dt + 0.6;
      const dx = h[0] - p.head.x;
      const dz = h[2] - p.head.z;
      const d = Math.hypot(dx, dz);
      if (d > max) {
        h[0] = p.head.x + (dx / d) * max;
        h[2] = p.head.z + (dz / d) * max;
      }
    }
    p.lastPoseAt = now;
    p.head.set(h[0], h[1], h[2]);
    p.pose.h = h.map((n) => round(n));
    p.pose.w = typeof m.w === 'string' && WEAPONS[m.w] ? m.w : null;
    if (Array.isArray(m.wp) && m.wp.length >= 7 && m.wp.every(Number.isFinite)) p.pose.wp = m.wp.slice(0, 7).map((n) => round(n));
    p.pose.a = Number.isFinite(m.a) ? round(THREE.MathUtils.clamp(m.a, 0, 1), 100) : 0;
    if (finite3(m.lh)) p.pose.lh = m.lh.slice(0, 3).map((n) => round(n));
    if (finite3(m.rh)) p.pose.rh = m.rh.slice(0, 3).map((n) => round(n));
  }

  /** Origen aportado por el cliente, aceptado solo si está junto a su cabeza. */
  originFor(p, o) {
    if (!finite3(o)) return p.head.clone();
    const v = V(o);
    return v.distanceTo(p.head) < 3 ? v : p.head.clone();
  }

  onFire(p, m) {
    if (!p.alive || p.inv.selected !== 'ranged' || !p.inv.ranged || !finite3(m.d)) return;
    const wid = p.inv.ranged;
    const w = WEAPONS[wid];
    if (this.time < (p.cdUntil[wid] ?? 0)) return;
    if (!this.infinite && p.inv.ammo <= 0) return this.notify(p, 'Sin munición');
    const dir = V(m.d).normalize();
    const power = THREE.MathUtils.clamp(Number.isFinite(m.p) ? m.p : 1, 0, 1);
    if (power < w.minPower) return;
    let speed;
    if (wid === 'sling') speed = w.minSpeed + (w.speed - w.minSpeed) * power;
    else if (wid === 'bow') speed = w.speed * power;
    else speed = w.speed;
    this.spawnProjectile(p, w.projectile, this.originFor(p, m.o), dir, speed);
    if (!this.infinite) p.inv.ammo = Math.max(0, p.inv.ammo - 1);
    p.cdUntil[wid] = this.time + w.cooldown;
    this.sendInv(p);
  }

  onThrow(p, m) {
    if (!p.alive || primaryAction(p.inv) !== 'throw' || !finite3(m.d)) return;
    const wid = selectedWeapon(p.inv);
    const w = WEAPONS[wid];
    if (this.time < (p.cdUntil[wid] ?? 0)) return;
    const power = THREE.MathUtils.clamp(Number.isFinite(m.p) ? m.p : 1, 0.35, 1);
    takeWeapon(p.inv, w.slot);
    p.inv.throwMode[wid] = false;
    this.spawnProjectile(p, wid, this.originFor(p, m.o), V(m.d).normalize(), w.throwSpeed * power);
    p.cdUntil[wid] = this.time + 0.4;
    this.sendInv(p);
  }

  onMelee(p, m) {
    if (!p.alive || !canMelee(p.inv) || !finite3(m.d)) return;
    const wid = selectedWeapon(p.inv);
    const w = WEAPONS[wid];
    if (this.time < (p.cdUntil[wid] ?? 0)) return;
    p.cdUntil[wid] = this.time + w.cooldown;
    const o = this.originFor(p, m.o);
    const d = V(m.d).normalize();
    const end = o.clone().addScaledVector(d, w.reach);
    this.emit({ t: 'swing', id: p.id, w: wid });

    let best = null;
    const consider = (t, target, head) => {
      if (t != null && (!best || t < best.t)) best = { t, target, head };
    };
    for (const q of this.players.values()) {
      if (q === p || !q.alive || this.mode !== 'pvp' || this.allies(p, q)) continue;
      consider(segSphere(o, end, q.head, HEAD_R + 0.12), q, true);
      const [ba, bb] = bodyCapsule(q);
      consider(segCapsule(o, end, ba, bb, BODY_R + 0.12), q, false);
    }
    for (const dm of this.dummies) {
      consider(segSphere(o, end, new THREE.Vector3(dm.pos.x, 1.62, dm.pos.z), HEAD_R + 0.12), dm, true);
      consider(segCapsule(o, end, new THREE.Vector3(dm.pos.x, 0.2, dm.pos.z), new THREE.Vector3(dm.pos.x, 1.4, dm.pos.z), BODY_R + 0.12), dm, false);
    }
    if (!best) return;
    // una pared entre medias bloquea el golpe
    const point = o.clone().lerp(end, best.t);
    for (const b of this.boxes) {
      const hit = segAABB(o, point, b.min, b.max);
      if (hit && hit.t < 0.98) return;
    }
    const speedFactor = THREE.MathUtils.clamp(Number.isFinite(m.v) ? m.v : 1, 0.5, 1.3);
    const dmg = w.damage * speedFactor * (best.head ? HEADSHOT_MULT * 0.75 : 1);
    this.damage(best.target, p, dmg, best.head, w.label, point);
  }

  onDrop(p) {
    if (!p.alive) return;
    const slot = p.inv.selected;
    const wid = weaponInSlot(p.inv, slot);
    if (!wid) return;
    const ammo = takeWeapon(p.inv, slot);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...p.pose.h.slice(3, 7)));
    f.y = 0;
    f.normalize();
    this.addItem({
      type: wid, count: Math.max(1, ammo), pos: [p.head.x + f.x * 0.9, 0.05, p.head.z + f.z * 0.9],
      quat: yawQuat(Math.atan2(-f.x, -f.z)), ttl: this.mode === 'pvp' ? 240 : null,
    });
    this.sendInv(p);
  }

  dropAll(p) {
    for (const slot of SLOTS) {
      const wid = weaponInSlot(p.inv, slot);
      if (!wid) continue;
      const ammo = takeWeapon(p.inv, slot);
      const a = Math.random() * Math.PI * 2;
      this.addItem({
        type: wid, count: Math.max(1, ammo), pos: [p.head.x + Math.cos(a) * 0.7, 0.05, p.head.z + Math.sin(a) * 0.7],
        quat: yawQuat(a), ttl: 240,
      });
    }
  }

  onPickup(p, id) {
    const it = this.items.get(id);
    if (!p.alive || !it || it.stuck && !WEAPONS[it.type]) return;
    if (V(it.pos).distanceTo(p.head) > 3.4) return;
    const w = WEAPONS[it.type];
    if (!w) return this.pickAmmo(p, it);
    let reason = pickBlockReason(p.inv, it.type);
    if (reason) {
      if (this.mode !== 'training') return this.notify(p, reason);
      takeWeapon(p.inv, w.slot); // en el campo de tiro se cambia directamente
      reason = null;
    }
    giveWeapon(p.inv, it.type, this.infinite ? w.maxAmmo : it.count);
    this.removeItem(it.id);
    this.scheduleRespawn(it);
    this.sendInv(p);
    return undefined;
  }

  pickAmmo(p, it) {
    if (!ammoFits(p.inv, it.type)) return;
    const added = addAmmo(p.inv, it.count);
    it.count -= added;
    if (it.count <= 0) {
      this.removeItem(it.id);
      this.scheduleRespawn(it);
    }
    this.sendInv(p);
  }

  /** Entrenamiento: devuelve a tu inventario lo lanzado y limpia el campo. */
  collect(p) {
    for (const it of [...this.items.values()]) {
      if (it.rack) continue;
      const w = WEAPONS[it.type];
      if (w && !weaponInSlot(p.inv, w.slot)) giveWeapon(p.inv, it.type, w.maxAmmo);
      this.removeItem(it.id);
    }
    this.sendInv(p);
  }

  // ---------------------------------------------------------------- proyectiles
  spawnProjectile(owner, type, origin, dir, speed) {
    const pr = {
      id: this.nextId++, type, owner: owner.id, pos: origin.clone(), vel: dir.clone().multiplyScalar(speed),
      wind: this.mode === 'training' ? this.wind.clone() : new THREE.Vector3(), age: 0, origin: origin.clone(),
    };
    this.projectiles.push(pr);
    this.emit({
      t: 'proj', id: pr.id, type, owner: owner.id, o: r3(origin), v: r3(pr.vel), w: r3(pr.wind),
    });
  }

  findHit(pr, p0, p1) {
    let best = null;
    const consider = (t, h) => {
      if (t != null && (!best || t < best.t)) best = { t, ...h };
    };
    for (const b of this.boxes) {
      const r = segAABB(p0, p1, b.min, b.max);
      if (r) consider(r.t, { kind: 'box' });
    }
    for (const tg of this.targets) {
      const d0 = p0.clone().sub(tg.centerV).dot(tg.normalV);
      const d1 = p1.clone().sub(tg.centerV).dot(tg.normalV);
      if (d0 >= 0 && d1 < 0) {
        const t = d0 / (d0 - d1);
        const r = p0.clone().lerp(p1, t).distanceTo(tg.centerV);
        if (r <= tg.bossRadius) consider(t, { kind: 'target', target: tg, r });
      }
    }
    for (const dm of this.dummies) {
      consider(segSphere(p0, p1, new THREE.Vector3(dm.pos.x, 1.62, dm.pos.z), HEAD_R), { kind: 'dummy', victim: dm, head: true });
      consider(segCapsule(p0, p1, new THREE.Vector3(dm.pos.x, 0.2, dm.pos.z), new THREE.Vector3(dm.pos.x, 1.4, dm.pos.z), BODY_R), { kind: 'dummy', victim: dm, head: false });
    }
    if (this.mode === 'pvp') {
      const shooter = this.players.get(pr.owner);
      for (const q of this.players.values()) {
        if (!q.alive || q.id === pr.owner || shooter && this.allies(shooter, q)) continue;
        consider(segSphere(p0, p1, q.head, HEAD_R), { kind: 'player', victim: q, head: true });
        const [ba, bb] = bodyCapsule(q);
        consider(segCapsule(p0, p1, ba, bb, BODY_R), { kind: 'player', victim: q, head: false });
      }
    }
    if (p1.y <= 0 && p0.y > 0) consider(p0.y / (p0.y - p1.y), { kind: 'ground' });
    return best;
  }

  stepProjectiles() {
    const p0 = new THREE.Vector3();
    const end = new THREE.Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      p0.copy(pr.pos);
      stepProjectile(pr.type, pr.pos, pr.vel, FIXED_DT, pr.wind);
      pr.age += FIXED_DT;
      const hit = this.findHit(pr, p0, pr.pos);
      if (hit) {
        end.lerpVectors(p0, pr.pos, hit.t);
        this.endProjectile(pr, hit, end);
        this.projectiles.splice(i, 1);
      } else if (pr.age > 15 || pr.pos.y < -3 || Math.abs(pr.pos.x) > 400 || Math.abs(pr.pos.z) > 400) {
        this.emit({ t: 'proj_end', id: pr.id, kind: 'lost', p: r3(pr.pos), q: [0, 0, 0, 1] });
        this.projectiles.splice(i, 1);
      }
    }
  }

  endProjectile(pr, hit, point) {
    const spec = PROJECTILES[pr.type];
    const dir = pr.vel.clone().normalize();
    const quat = dirQuat(dir);
    const owner = this.players.get(pr.owner);
    const isAmmo = AMMO_ITEMS.includes(pr.type);
    const isRanged = isAmmo;
    const speedFactor = THREE.MathUtils.clamp(pr.vel.length() / spec.refSpeed, 0.35, 1.15);
    const stuckPos = point.clone().addScaledVector(dir, spec.embed);
    let itemPos = stuckPos;
    let stuck = true;
    let victimId = null;

    if (hit.kind === 'target') {
      const sc = scoreHit(hit.r, hit.target.faceRadius);
      if (owner) {
        this.emit({
          t: 'score', ring: sc.ring, label: sc.label, x: sc.x, kind: 'target', index: hit.target.index,
          distance: Math.hypot(point.x - pr.origin.x, point.z - pr.origin.z), p: r3(point), n: hit.target.normal,
          faceRadius: hit.target.faceRadius,
        }, owner.id);
      }
    } else if (hit.kind === 'dummy' || hit.kind === 'player') {
      const dmg = spec.damage * speedFactor * (hit.head ? HEADSHOT_MULT : 1);
      const wl = WEAPONS[pr.type]?.label ?? { arrow: 'Arco', bolt: 'Ballesta', stone: 'Honda' }[pr.type];
      if (owner) this.damage(hit.victim, owner, dmg, hit.head, wl, point);
      victimId = hit.victim.id;
      const vp = hit.victim.pos ?? hit.victim.head;
      itemPos = new THREE.Vector3(vp.x + dir.x * 0.3, 0.05, vp.z + dir.z * 0.3);
      stuck = false;
    } else if (hit.kind === 'ground') {
      if (owner && this.mode === 'training' && isRanged) {
        this.emit({
          t: 'score', ring: 0, label: 'M', x: false, kind: 'ground', distance: Math.hypot(point.x - pr.origin.x, point.z - pr.origin.z), p: r3(point),
        }, owner.id);
      }
      itemPos = point.clone();
    }
    if (pr.type === 'stone') {
      // las piedras no se clavan: caen al suelo
      stuck = false;
      itemPos = new THREE.Vector3(point.x, 0.03, point.z);
    }

    this.emit({
      t: 'proj_end', id: pr.id, kind: hit.kind, type: pr.type, p: r3(point), q: quat, victim: victimId, head: !!hit.head,
    });

    const ttl = WEAPONS[pr.type] ? (this.mode === 'pvp' ? 240 : null) : (this.mode === 'pvp' ? 90 : 120);
    this.addItem({
      type: pr.type, count: 1, pos: r3(itemPos), quat: stuck ? quat : yawQuat(Math.random() * 6.28),
      stuck: stuck && pr.type !== 'stone', ttl,
    });
  }

  // ---------------------------------------------------------------- daño y partida
  damage(victim, attacker, dmg, head, weaponLabel, point) {
    dmg = Math.round(dmg);
    if (victim.pos) { // muñeco de entrenamiento
      this.emit({ t: 'hit', v: victim.id, a: attacker.id, dmg, head, p: r3(point), hp: 100 });
      return;
    }
    if (!victim.alive) return;
    victim.hp = Math.max(0, victim.hp - dmg);
    this.emit({ t: 'hit', v: victim.id, a: attacker.id, dmg, head, p: r3(point), hp: victim.hp });
    if (victim.hp > 0) return;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = this.time + RESPAWN_TIME;
    if (attacker !== victim) {
      attacker.kills++;
      if (this.teams) this.teamKills[attacker.team]++;
    }
    this.dropAll(victim);
    this.emit({ t: 'kill', k: attacker.id, kn: attacker.name, v: victim.id, vn: victim.name, w: weaponLabel });
    this.sendScores();
    if (this.winner) return;
    if (this.teams) {
      if (this.teamKills[attacker.team] >= this.killLimit) {
        this.winner = `team${attacker.team}`;
        this.matchResetAt = this.time + 8;
        this.emit({ t: 'match_end', winner: this.winner, team: attacker.team, name: `Escuadra ${teamName(attacker.team)}` });
      }
    } else if (attacker.kills >= this.killLimit) {
      this.winner = attacker.id;
      this.matchResetAt = this.time + 8;
      this.emit({ t: 'match_end', winner: attacker.id, name: attacker.name });
    }
  }

  // ---------------------------------------------------------------- bucle
  update(dt) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= FIXED_DT) {
      this.acc -= FIXED_DT;
      this.step();
    }
  }

  step() {
    this.time += FIXED_DT;
    this.stepProjectiles();

    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].at) {
        const { fn } = this.timers[i];
        this.timers.splice(i, 1);
        fn();
      }
    }
    for (const it of [...this.items.values()]) {
      if (it.expires && this.time > it.expires) this.removeItem(it.id);
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.mode === 'pvp' && !this.winner && this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      // la munición del suelo se recoge sola al pasar por encima
      if (p.inv.ranged && !this.infinite) {
        for (const it of this.items.values()) {
          if (!AMMO_ITEMS.includes(it.type) || it.stuck && it.pos[1] > 2.2) continue;
          if (Math.hypot(it.pos[0] - p.head.x, it.pos[2] - p.head.z) < PICKUP_R && ammoFits(p.inv, it.type)) {
            this.pickAmmo(p, it);
            break;
          }
        }
      }
    }

    if (this.winner && this.time >= this.matchResetAt) this.resetMatch();
  }

  resetMatch() {
    this.winner = null;
    this.teamKills.fill(0);
    this.resetItems();
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      this.spawn(p);
    }
    this.emit({ t: 'match_start' });
    this.sendScores();
  }

  /** Estado compacto de las poses para difundir a los clientes. */
  snapshot() {
    return {
      t: 'snap',
      p: [...this.players.values()].map((p) => [
        p.id, p.pose.h, p.pose.w, p.pose.wp, p.pose.a, p.pose.lh, p.pose.rh, p.hp, p.alive ? 1 : 0,
      ]),
    };
  }
}
