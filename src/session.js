import * as THREE from 'three';
import { emptyInventory, PLAYER_HP, WEAPONS, selectedWeapon, isThrowing } from '../shared/weapons.js';
import { ProjectileView } from './projectiles.js';
import { ItemView } from './items.js';
import { RemotePlayers } from './avatars.js';
import { Effects } from './effects.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * Estado del jugador local + procesado de todos los eventos de la simulación (vengan del servidor o del bucle local).
 * No sabe nada de teclado/VR: los controles le piden acciones (select, drop, pickup…) y leen su estado.
 */
export class GameSession {
  constructor({ scene, audio, mode, transport, hooks = {} }) {
    this.scene = scene;
    this.audio = audio;
    this.mode = mode;
    this.transport = transport;
    this.hooks = hooks;
    this.projectiles = new ProjectileView(scene, audio);
    this.items = new ItemView(scene);
    this.remote = new RemotePlayers(scene);
    this.effects = new Effects(scene);

    this.myId = null;
    this.inv = emptyInventory();
    this.infinite = mode === 'training';
    this.hp = PLAYER_HP;
    this.alive = false;
    this.killLimit = 15;
    this.teams = 0; // nº de escuadras de la sala (0 = todos contra todos)
    this.teamKills = [];
    this.players = new Map(); // id -> {name, k, d, team}
    this.feed = [];
    this.banner = null;
    this.hitMarker = 0;
    this.hurt = 0;
    this.deathAt = 0;
    this.killerName = '';
    this.time = 0;

    transport.onmessage = (m) => this.handle(m);
  }

  // ----------------------------------------------------------------------- acciones del jugador
  send(msg) {
    this.transport.send(msg);
  }

  selectSlot(slot) {
    this.send({ t: 'select', slot });
  }

  cycle(dir = 1) {
    this.send({ t: 'select', cycle: dir });
  }

  toggleMode() {
    this.send({ t: 'mode' });
  }

  drop() {
    this.send({ t: 'drop' });
  }

  pickup(id) {
    this.send({ t: 'pickup', id });
    this.audio.playGlobal('pickup', 0.6);
  }

  collect() {
    this.send({ t: 'collect' });
  }

  setLoadout(loadout) {
    this.send({ t: 'loadout', loadout });
  }

  setTeam(team) {
    this.send({ t: 'team', team });
  }

  get myTeam() {
    return this.players.get(this.myId)?.team ?? null;
  }

  // ----------------------------------------------------------------------- eventos
  handle(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.infinite = m.infinite;
        this.killLimit = m.killLimit;
        this.teams = m.teams ?? 0;
        this.teamKills = m.teamKills ?? [];
        this.players.clear();
        for (const p of m.players) {
          this.players.set(p.id, { name: p.name, k: p.k, d: p.d, team: p.team ?? null });
          if (p.id !== m.id) this.remote.add(p.id, p.name, p.team ?? null);
        }
        this.items.clear();
        for (const it of m.items) this.items.add(it);
        break;
      case 'inv':
        this.onInventory(m);
        break;
      case 'spawn':
        if (m.id === this.myId) {
          this.alive = true;
          this.hp = PLAYER_HP;
          this.hooks.onSpawn?.(V(m.pos), m.yaw);
        }
        break;
      case 'join':
        if (m.id !== this.myId) {
          this.remote.add(m.id, m.name, m.team ?? null);
          this.players.set(m.id, { name: m.name, k: 0, d: 0, team: m.team ?? null });
          this.pushFeed(`${m.name} ha entrado`);
        }
        break;
      case 'leave': {
        const p = this.players.get(m.id);
        if (p) this.pushFeed(`${p.name} se ha ido`);
        this.players.delete(m.id);
        this.remote.remove(m.id);
        break;
      }
      case 'scores':
        for (const p of m.list) {
          this.players.set(p.id, { name: p.name, k: p.k, d: p.d, team: p.team ?? null });
          this.remote.rename(p.id, p.name);
          this.remote.setTeam(p.id, p.team ?? null);
        }
        this.teamKills = m.tk ?? this.teamKills;
        break;
      case 'team':
        if (m.id === this.myId) this.hooks.onTeam?.(m.team);
        break;
      case 'snap':
        this.remote.applySnapshot(m.p, this.myId);
        break;
      case 'proj':
        this.onProjectile(m);
        break;
      case 'proj_end':
        this.onProjectileEnd(m);
        break;
      case 'item_add':
        this.items.add(m.item);
        break;
      case 'item_remove':
        this.items.remove(m.id);
        break;
      case 'score':
        this.hooks.onScore?.(m);
        break;
      case 'hit':
        this.onHit(m);
        break;
      case 'kill':
        this.onKill(m);
        break;
      case 'swing':
        if (m.id !== this.myId) {
          this.remote.swing(m.id);
          const a = this.remote.avatars.get(m.id);
          if (a) this.audio.playAt('swing', a.pos, 1.2);
        }
        break;
      case 'msg':
        this.hooks.toast?.(m.text);
        break;
      case 'match_end':
        this.banner = `¡${m.name} gana la partida!`;
        break;
      case 'match_start':
        this.banner = null;
        this.hooks.toast?.('¡Nueva partida!');
        break;
      default:
        break;
    }
  }

  onInventory(m) {
    const prevId = selectedWeapon(this.inv);
    const prevThrow = prevId ? isThrowing(this.inv, prevId) : null;
    this.inv = m.inv;
    this.infinite = m.inf;
    const id = selectedWeapon(m.inv);
    if (!id || !WEAPONS[id].throwable) return;
    if (WEAPONS[id].hitAndThrow) return; // el hacha golpea y se lanza sin modos: nada que explicar
    if (prevId === id && prevThrow !== isThrowing(m.inv, id)) {
      this.hooks.toast?.(isThrowing(m.inv, id)
        ? `Modo LANZAR: mantén clic y suelta`
        : 'Modo cuerpo a cuerpo');
    } else if (!this.throwTipShown) {
      this.throwTipShown = true; // primera vez que llevas algo lanzable
      this.hooks.toast?.(`${WEAPONS[id].label}: F o clic derecho = modo LANZAR (VR: B/Y)`, 5);
    }
  }

  onProjectile(m) {
    this.projectiles.spawn(m);
    const own = m.owner === this.myId;
    const speed = Math.hypot(m.v[0], m.v[1], m.v[2]);
    const pos = V(m.o);
    const sound = { arrow: 'twang', bolt: 'crossbow', stone: 'sling', axe: 'swing', spear: 'swing' }[m.type];
    if (own) {
      if (m.type === 'arrow') this.audio.twang(speed / 68);
      else this.audio.playGlobal(sound, 0.9);
    } else {
      this.audio.playAt(sound, pos, 1.6);
    }
  }

  onProjectileEnd(m) {
    this.projectiles.end(m.id);
    if (m.kind === 'lost') return;
    const p = V(m.p);
    const type = m.type;
    switch (m.kind) {
      case 'target':
        this.audio.hit(p, 'target');
        break;
      case 'player':
      case 'dummy':
        this.audio.playAt('flesh', p, 2.2);
        this.effects.burst(p, 0xc02020, 8, 2.5);
        break;
      case 'box':
        this.audio.playAt(type === 'stone' ? 'thudGround' : 'clang', p, 1.6);
        this.effects.burst(p, 0xd8d2c4, 6, 2);
        break;
      default:
        this.audio.hit(p, 'ground');
        this.effects.burst(p, 0x9a8458, 5, 1.5);
    }
  }

  onHit(m) {
    const p = V(m.p);
    if (m.v === this.myId) {
      this.hp = m.hp;
      this.hurt = 0.6;
      this.audio.playGlobal('hurt', 1);
      this.hooks.onHurt?.(m);
    }
    if (m.a === this.myId && m.v !== this.myId) {
      this.hitMarker = 0.25;
      this.effects.float(p.clone().add(new THREE.Vector3(0, 0.3, 0)), String(m.dmg), {
        color: m.head ? '#ffd23f' : '#ff8a80', size: m.head ? 0.4 : 0.3, life: 1.1,
      });
      if (m.head) this.audio.ding();
      this.hooks.onDealt?.(m);
    }
    if (typeof m.v === 'string' && m.v.startsWith('d')) this.hooks.onDummyHit?.(m.v);
  }

  onKill(m) {
    this.pushFeed(`${m.kn} ▸ ${m.vn}  (${m.w})`);
    if (m.v === this.myId) {
      this.alive = false;
      this.deathAt = this.time;
      this.killerName = m.kn;
      this.hooks.onDeath?.(m);
    } else if (m.k === this.myId) {
      this.hooks.toast?.(`Has eliminado a ${m.vn}`);
    }
  }

  pushFeed(text) {
    this.feed.push({ text, t: this.time });
    if (this.feed.length > 6) this.feed.shift();
  }

  update(dt) {
    this.time += dt;
    this.transport.update(dt);
    this.projectiles.update(dt);
    this.items.update(dt);
    this.remote.update(dt);
    this.effects.update(dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    while (this.feed.length && this.time - this.feed[0].t > 8) this.feed.shift();
  }

  get scoreList() {
    return [...this.players.entries()].map(([id, p]) => ({ id, ...p })).sort((a, b) => b.k - a.k || a.d - b.d);
  }
}
