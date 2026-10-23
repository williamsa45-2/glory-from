import * as THREE from 'three';
import { WEAPONS, selectedWeapon } from '../shared/weapons.js';
import { pushOutOfBoxes } from '../shared/geometry.js';
import { DesktopWeapons } from './weaponControl.js';
import { createBody, stepVertical, WALK_SPEED, RUN_SPEED } from './movement.js';

const EYE_HEIGHT = 1.65;
const POSE_INTERVAL = 0.05; // 20 Hz
const PICKUP_REACH = 2.8;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Primera persona con puntero bloqueado: ratón para apuntar/atacar, WASD para moverse. */
export class DesktopControls {
  constructor(game) {
    this.game = game;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.primary = false;
    this.zoom = false;
    this.locked = false;
    this.time = 0;
    this.poseTimer = 0;
    this.showScores = false;
    this.hint = '';
    this.body = createBody();
    this.sprinting = false;
    this.weapons = new DesktopWeapons({ camera: game.camera, bow: game.bow, session: game.session, audio: game.audio });

    const canvas = game.renderer.domElement;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.primary = false;
        this.zoom = false;
        this.showScores = false;
      }
      game.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.0022 * (game.camera.fov / 72);
      this.yaw -= e.movementX * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * k, -1.5, 1.5);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.primary = true;
      if (e.button === 2) {
        this.zoom = true;
        // con hacha o lanza, el clic derecho también alterna lanzar ⇄ cuerpo a cuerpo
        const sel = selectedWeapon(game.session.inv);
        if (sel && WEAPONS[sel].throwable) game.session.toggleMode();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primary = false;
      if (e.button === 2) this.zoom = false;
    });
    document.addEventListener('wheel', (e) => {
      if (this.locked) game.session.cycle(e.deltaY > 0 ? 1 : -1);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Tab') {
        e.preventDefault();
        this.showScores = true;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.showScores = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.primary = false;
      this.zoom = false;
    });
  }

  onKey(code) {
    const { session } = this.game;
    switch (code) {
      case 'Digit1': return session.selectSlot('melee');
      case 'Digit2': return session.selectSlot('spear');
      case 'Digit3': return session.selectSlot('ranged');
      case 'KeyQ': return session.cycle(1);
      case 'KeyF': return session.toggleMode();
      case 'KeyX': return session.drop();
      case 'KeyE': return this.pickupNearest();
      case 'KeyR': return this.game.collect?.();
      case 'KeyG': return this.game.toggleLadder?.();
      case 'KeyT': return this.game.toggleWind?.();
      case 'KeyN': return this.game.newGame?.();
      default: return undefined;
    }
  }

  pickupNearest() {
    const { session } = this.game;
    if (!session.alive) return;
    const item = session.items.nearest(this.weapons.headPosition(_p), PICKUP_REACH, (i) => !!WEAPONS[i.type] || session.inv.ranged);
    if (item) session.pickup(item.id);
    else session.hooks.toast?.('No hay nada que recoger cerca');
  }

  requestLock() {
    const r = this.game.renderer.domElement.requestPointerLock?.();
    r?.catch?.(() => {}); // sin gesto del usuario el navegador lo rechaza: la pausa permite reintentar
  }

  /** Coloca al jugador (aparición en el mapa). */
  teleport(pos, yaw) {
    this.game.rig.position.set(pos.x, 0, pos.z);
    this.body.y = 0;
    this.body.vy = 0;
    this.yaw = yaw;
    this.pitch = 0;
  }

  /** Vuelve al modo escritorio tras salir de VR. */
  resetView() {
    const { camera, rig } = this.game;
    camera.position.set(0, EYE_HEIGHT, 0);
    camera.quaternion.identity();
    camera.rotation.set(this.pitch, 0, 0);
    this.weapons.rebind();
    rig.rotation.set(0, this.yaw, 0);
  }

  update(dt) {
    const { camera, rig, session, collision } = this.game;
    this.time += dt;

    let mx = 0;
    let mz = 0;
    if (session.alive) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    }
    const moving = mx !== 0 || mz !== 0;
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    // correr: Mayús + avanzar; no se corre mientras se tensa el arco, se gira la honda o se prepara un lanzamiento
    this.sprinting = shift && mz < 0 && !this.weapons.charging;
    if (moving) {
      const len = Math.hypot(mx, mz);
      let speed = this.sprinting ? RUN_SPEED : WALK_SPEED;
      if (this.weapons.charging) speed *= 0.45;
      else if (this.weapons.zoomWanted) speed *= 0.6;
      speed *= dt;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      rig.position.x += ((mx * cos + mz * sin) / len) * speed;
      rig.position.z += ((-mx * sin + mz * cos) / len) * speed;
      collision.apply(rig.position, this.body.y);
    }

    // salto y caída (Espacio): se puede subir a cajas y saltar muros bajos
    this.body.y = rig.position.y;
    stepVertical(this.body, dt, (feet) => collision.support(rig.position, feet), session.alive && this.keys.has('Space'));
    rig.position.y = this.body.y;

    // control con manos: mientras se tensa, la mano del arco afina la puntería (se suma al ratón)
    const aim = this.game.hands?.takeAim();
    if (aim && this.locked) {
      const k = camera.fov / 72;
      this.yaw += aim.yaw * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch + aim.pitch * k, -1.5, 1.5);
    }

    rig.rotation.y = this.yaw;
    camera.rotation.set(this.pitch, 0, 0);
    camera.position.set(0, EYE_HEIGHT, 0);

    const targetFov = this.weapons.zoomWanted ? 36 : this.sprinting && moving ? 80 : 72;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }

    // el pellizco de la cámara (control con manos) hace de clic izquierdo mantenido
    const pinch = this.locked && !!this.game.hands?.pinch;
    this.weapons.update(dt, { primary: session.alive && (this.primary || pinch), zoom: this.zoom });
    this.updateHint();

    this.poseTimer -= dt;
    if (this.poseTimer <= 0) {
      this.poseTimer = POSE_INTERVAL;
      this.sendPose();
    }
  }

  updateHint() {
    const { session } = this.game;
    this.hint = '';
    if (!session.alive || !this.locked) return;
    const item = session.items.nearest(this.weapons.headPosition(_p), PICKUP_REACH, (i) => !!WEAPONS[i.type]);
    if (item) this.hint = `[E] Recoger ${WEAPONS[item.type].label}`;
  }

  sendPose() {
    const { camera, session } = this.game;
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(_p);
    camera.getWorldQuaternion(_q);
    const wp = this.weapons.worldPose();
    const h = new THREE.Vector3(-0.28, -0.4, -0.25).applyQuaternion(_q).add(_p);
    const msg = {
      t: 'pose',
      h: [_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w],
      w: wp?.id ?? null,
      wp: wp ? [wp.pos.x, wp.pos.y, wp.pos.z, wp.quat.x, wp.quat.y, wp.quat.z, wp.quat.w] : [0, 0, 0, 0, 0, 0, 1],
      a: wp?.aux ?? 0,
      lh: [h.x, h.y, h.z],
      rh: wp ? [wp.pos.x, wp.pos.y, wp.pos.z] : [_p.x, _p.y - 0.5, _p.z],
    };
    session.send(msg);
  }
}
