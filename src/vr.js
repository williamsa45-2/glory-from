import * as THREE from 'three';
import { WEAPONS, selectedWeapon, primaryAction } from '../shared/weapons.js';
import { segSegDist2 } from '../shared/geometry.js';
import { BRACE, MAX_DRAW } from './physics.js';
import { createWeaponModel } from './weaponModels.js';
import { WristPanel } from './inventoryUi.js';
import { createBody, stepVertical } from './movement.js';

const GRAB_RADIUS = 0.35; // alcance de la mano de tiro respecto al punto de enganche del arco
const WALK_SPEED = 1.8;
const RUN_SPEED = 4.2; // stick izquierdo a fondo
const SNAP_ANGLE = THREE.MathUtils.degToRad(30);
const SINGLE_DRAW_TIME = 1.0;
const POSE_INTERVAL = 0.05;
const SWING_MIN_SPEED = 2.2; // m/s en la punta del arma para contar como golpe
const PICKUP_REACH = 1.8;

const _bowPos = new THREE.Vector3();
const _bowQuat = new THREE.Quaternion();
const _drawPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _head = new THREE.Vector3();
const _move = new THREE.Vector3();
const _right = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const deadzone = (v) => (Math.abs(v) < 0.15 ? 0 : v);

/**
 * Tiro y combate en VR.
 *  - Arco: una mano lo sostiene, la otra tensa la cuerda con el gatillo (la flecha sale por la línea entre manos).
 *  - Espada/hacha/lanza: en la mano dominante; el golpe cuenta por la velocidad real de la hoja.
 *  - Lanzar: se lanza con la velocidad de la mano al soltar el gatillo.
 *  - Ballesta: gatillo. Honda: mantén el gatillo para hacerla girar y suelta para lanzar.
 * Funciona con dos mandos, con uno solo o con manos (pellizco = gatillo).
 */
export class VRControls {
  constructor(game) {
    this.game = game;
    this.controllers = [];
    this.grips = [];
    this.drawing = false;
    this.draw = 0;
    this.cooldown = 0;
    this.snapReady = true;
    this.prevButtons = new Map();
    this.lastPulse = 0;
    this.aim = new THREE.Vector3(0, 0, -1);
    this.poseTimer = 0;
    this.models = new Map();
    this.held = null; // {id, obj, parent}
    this.charge = 0;
    this.loaded = true;
    this.prevPressed = false;
    this.wrist = new WristPanel();
    this.wristParent = null;
    this.time = 0;
    this.body = createBody();

    const { renderer, rig } = game;
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      Object.assign(c.userData, {
        handedness: null, inputSource: null, pressed: false, lastPos: new THREE.Vector3(), vel: new THREE.Vector3(), hist: [],
      });
      c.addEventListener('connected', (e) => {
        c.userData.inputSource = e.data;
        c.userData.handedness = e.data.handedness;
      });
      c.addEventListener('disconnected', () => {
        c.userData.inputSource = null;
        c.userData.handedness = null;
        c.userData.pressed = false;
      });
      c.addEventListener('selectstart', () => (c.userData.pressed = true));
      c.addEventListener('selectend', () => (c.userData.pressed = false));
      c.addEventListener('squeezestart', () => this.pickupNear(c));
      rig.add(c);
      this.controllers.push(c);

      const grip = renderer.xr.getControllerGrip(i);
      const hand = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.03, 0.08, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6 })
      );
      hand.rotation.x = Math.PI / 2;
      hand.position.z = 0.03;
      grip.add(hand);
      rig.add(grip);
      this.grips.push(grip);
    }
  }

  // ----------------------------------------------------------------------- manos
  /** Decide cuál es la mano dominante (arma) y cuál la libre (arco, panel). Sin suponer ningún visor concreto. */
  resolveHands() {
    const connected = this.controllers.filter((c) => c.userData.inputSource);
    const pref = this.game.settings?.hand ?? 'right';
    const dom = connected.find((c) => c.userData.handedness === pref) ?? connected[0] ?? null;
    const off = connected.find((c) => c !== dom) ?? null;
    return { dom, off };
  }

  pulse(controller, intensity, ms) {
    try {
      controller?.userData.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      /* sin vibración */
    }
  }

  hurtPulse() {
    for (const c of this.controllers) this.pulse(c, 0.9, 150);
  }

  dealtPulse() {
    const { dom } = this.resolveHands();
    this.pulse(dom, 0.8, 100);
  }

  pickupNear(controller) {
    const { session } = this.game;
    if (!session.alive) return;
    controller.getWorldPosition(_hand);
    const item = session.items.nearest(_hand, PICKUP_REACH, (i) => !!WEAPONS[i.type] || session.inv.ranged);
    if (item) {
      session.pickup(item.id);
      this.pulse(controller, 0.5, 60);
    }
  }

  // ----------------------------------------------------------------------- sesión
  begin() {
    const { rig, bow, scene, world, desktop } = this.game;
    rig.rotation.set(0, 0, 0);
    bow.group.removeFromParent();
    bow.group.scale.setScalar(1);
    scene.add(bow.group);
    bow.setNock(BRACE);
    desktop.weapons.holder.visible = false;
    world.sun.castShadow = false; // las sombras cuestan demasiado en visores autónomos
    this.drawing = false;
    this.draw = 0;
    this.held = null;
    this.teleport(new THREE.Vector3(rig.position.x, 0, rig.position.z), 0);
  }

  end() {
    this.game.world.sun.castShadow = true;
    this.setHeld(null);
    this.game.bow.group.visible = true;
    this.wrist.object3d.removeFromParent();
    this.wristParent = null;
  }

  /** Coloca al jugador de modo que su cabeza quede sobre (pos.x, pos.z). */
  teleport(pos, yaw) {
    const { rig, camera } = this.game;
    rig.rotation.y = yaw;
    rig.position.set(pos.x, 0, pos.z);
    this.body.y = 0;
    this.body.vy = 0;
    rig.updateMatrixWorld(true);
    camera.getWorldPosition(_head);
    rig.position.x += pos.x - _head.x;
    rig.position.z += pos.z - _head.z;
  }

  /** Velocidad de la mano sobre una ventana de ~90 ms (robusta ante fotogramas sin cambio de pose). */
  trackHand(c) {
    const u = c.userData;
    c.getWorldPosition(_hand);
    const h = u.posHist ?? (u.posHist = []);
    h.push({ t: this.time, p: _hand.clone() });
    while (h.length > 2 && this.time - h[0].t > 0.3) h.shift();
    let i0 = 0;
    while (i0 < h.length - 2 && this.time - h[i0 + 1].t >= 0.09) i0++;
    const a = h[i0];
    const b = h[h.length - 1];
    u.vel.copy(b.p).sub(a.p).divideScalar(Math.max(b.t - a.t, 1e-3));
    u.hist.push({ t: this.time, v: u.vel.clone() });
    while (u.hist.length > 12 || (u.hist.length > 1 && this.time - u.hist[0].t > 0.3)) u.hist.shift();
  }

  // ----------------------------------------------------------------------- arma en mano
  setHeld(id, parent = null) {
    if (this.held && this.held.id === id && this.held.parent === parent) return;
    if (this.held?.obj) this.held.obj.removeFromParent();
    this.held = null;
    if (!id || id === 'bow' || !parent) return;
    if (!this.models.has(id)) this.models.set(id, createWeaponModel(id));
    const obj = this.models.get(id);
    obj.position.set(0, 0, 0.04);
    obj.rotation.set(id === 'crossbow' ? 0 : -0.35, 0, id === 'axe' ? -Math.PI / 2 : 0); // algo levantada; el hacha con el filo al frente
    obj.scale.setScalar(1);
    parent.add(obj);
    this.held = { id, obj, parent };
    this.charge = 0;
  }

  haveAmmo() {
    const s = this.game.session;
    return s.infinite || s.inv.ammo > 0;
  }

  // ----------------------------------------------------------------------- bucle
  update(dt) {
    const { rig, bow, session } = this.game;
    this.time += dt;
    this.pollGamepads(dt);
    rig.updateMatrixWorld(true);

    const { dom, off } = this.resolveHands();
    for (const c of this.controllers) {
      this.trackHand(c);
    }

    // panel de inventario sobre el mando libre
    const wristHost = this.grips[this.controllers.indexOf(off ?? dom)] ?? null;
    if (wristHost && this.wristParent !== wristHost) {
      this.wrist.object3d.removeFromParent();
      this.wrist.object3d.position.set(0, 0.1, 0.09);
      this.wrist.object3d.rotation.set(-Math.PI / 2 + 0.45, 0, 0);
      wristHost.add(this.wrist.object3d);
      this.wristParent = wristHost;
    }
    this.wrist.update(session);

    this.cooldown = Math.max(0, this.cooldown - dt);
    const id = session.alive ? selectedWeapon(session.inv) : null;
    const action = id ? primaryAction(session.inv) : null;
    const isBow = id === 'bow';
    bow.group.visible = isBow && !!dom;
    this.setHeld(isBow ? null : id, isBow ? null : dom);
    let wp = null;

    if (dom && id) {
      if (isBow) wp = this.updateBow(dt, dom, off);
      else if (action === 'ranged' && id === 'crossbow') this.updateCrossbow(dt, dom);
      else if (action === 'ranged' && id === 'sling') this.updateSling(dt, dom);
      else if (action === 'melee') this.updateMelee(dt, id, dom);
      else if (action === 'throw') {
        // el hacha golpea moviéndola con fuerza (sin gatillo) y se lanza soltando el gatillo en movimiento
        if (WEAPONS[id].hitAndThrow && !dom.userData.pressed) this.updateMelee(dt, id, dom);
        this.updateThrow(dt, id, dom);
      }
      this.prevPressed = dom.userData.pressed;
    }

    this.poseTimer -= dt;
    if (this.poseTimer <= 0) {
      this.poseTimer = POSE_INTERVAL;
      this.sendPose(id, dom, off, wp);
    }
  }

  // ---- arco
  updateBow(dt, dom, off) {
    const { bow } = this.game;
    // con un solo mando: el mando sostiene el arco y el gatillo tensa con el tiempo
    const bowC = off ?? dom;
    const drawC = off ? dom : null;
    bowC.getWorldPosition(_bowPos);
    bowC.getWorldQuaternion(_bowQuat);
    _fwd.set(0, 0, -1).applyQuaternion(_bowQuat);
    _up.set(0, 1, 0).applyQuaternion(_bowQuat);
    const ready = this.cooldown === 0;
    bow.setArrowVisible(ready && this.haveAmmo());

    if (drawC) {
      drawC.getWorldPosition(_drawPos);
      if (!this.drawing && ready && this.haveAmmo() && drawC.userData.pressed) {
        const hook = _hand.copy(_bowPos).addScaledVector(_fwd, -(BRACE + 0.05));
        if (_drawPos.distanceTo(hook) < GRAB_RADIUS) {
          this.drawing = true;
          this.game.audio.nock();
          this.pulse(drawC, 0.35, 40);
        }
      }
      if (this.drawing) {
        if (!drawC.userData.pressed) {
          this.orient(this.aim);
          this.releaseBow(drawC, bowC);
        } else {
          const toBow = _hand.copy(_bowPos).sub(_drawPos);
          const dist = toBow.length();
          toBow.divideScalar(dist || 1);
          const t = THREE.MathUtils.smoothstep(dist, 0.2, 0.45);
          _aim.copy(_fwd).lerp(toBow, t).normalize();
          this.aim.copy(_aim);
          this.orient(_aim);
          const nockZ = THREE.MathUtils.clamp(dist, BRACE, BRACE + MAX_DRAW);
          this.draw = (nockZ - BRACE) / MAX_DRAW;
          bow.setNock(nockZ);
          this.tensionHaptics(drawC, bowC);
        }
      }
    } else if (bowC.userData.pressed && ready && this.haveAmmo()) {
      if (!this.drawing) {
        this.drawing = true;
        this.game.audio.nock();
      }
      this.draw = Math.min(1, this.draw + dt / SINGLE_DRAW_TIME);
      this.aim.copy(_fwd);
      bow.setNock(BRACE + MAX_DRAW * this.draw);
      this.tensionHaptics(null, bowC);
    } else if (this.drawing) {
      this.orient(this.aim);
      this.releaseBow(null, bowC);
    }

    bow.group.position.copy(_bowPos);
    bow.group.quaternion.copy(_bowQuat);
    bow.group.updateMatrixWorld(true);
    return { pos: _bowPos.clone(), quat: _bowQuat.clone(), aux: this.draw };
  }

  tensionHaptics(drawC, bowC) {
    const now = performance.now();
    if (now - this.lastPulse > 70) {
      this.lastPulse = now;
      this.pulse(drawC, 0.08 + 0.3 * this.draw, 60);
      this.pulse(bowC, 0.05 + 0.15 * this.draw, 60);
    }
  }

  /** Orienta el arco (_bowQuat) hacia `aim` conservando el "arriba" del mando. */
  orient(aim) {
    _z.copy(aim).negate();
    _x.crossVectors(_up, _z).normalize();
    _y.crossVectors(_z, _x);
    _bowQuat.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  }

  releaseBow(drawC, bowC) {
    const { bow, session } = this.game;
    const p = this.draw;
    this.drawing = false;
    this.draw = 0;
    if (p < 0.12) {
      bow.setNock(BRACE);
      return;
    }
    bow.group.position.copy(_bowPos);
    bow.group.quaternion.copy(_bowQuat);
    bow.group.updateMatrixWorld(true);
    bow.arrow.getWorldPosition(_origin);
    session.send({ t: 'fire', o: [_origin.x, _origin.y, _origin.z], d: [this.aim.x, this.aim.y, this.aim.z], p });
    bow.release();
    this.cooldown = WEAPONS.bow.cooldown;
    this.pulse(drawC, 1, 90);
    this.pulse(bowC, 0.8, 120);
  }

  // ---- ballesta
  updateCrossbow(dt, dom) {
    const { session, audio } = this.game;
    const model = this.held?.obj;
    if (!model) return;
    if (!this.loaded && this.cooldown === 0 && this.haveAmmo()) {
      this.loaded = true;
      audio.nock();
      this.pulse(dom, 0.4, 50);
    }
    model.userData.setLoaded(this.loaded && this.haveAmmo());
    if (dom.userData.pressed && !this.prevPressed && this.cooldown === 0 && this.loaded && this.haveAmmo()) {
      model.updateMatrixWorld(true);
      _origin.set(0, 0.06, -0.45);
      model.localToWorld(_origin);
      model.getWorldQuaternion(_q);
      _aim.set(0, 0, -1).applyQuaternion(_q);
      session.send({ t: 'fire', o: [_origin.x, _origin.y, _origin.z], d: [_aim.x, _aim.y, _aim.z], p: 1 });
      this.loaded = false;
      this.cooldown = WEAPONS.crossbow.cooldown;
      this.pulse(dom, 1, 120);
    }
  }

  // ---- honda
  updateSling(dt, dom) {
    const { session } = this.game;
    const model = this.held?.obj;
    if (!model) return;
    model.userData.setStoneVisible(this.haveAmmo());
    const cords = model.userData.cords;
    if (dom.userData.pressed && this.cooldown === 0 && this.haveAmmo()) {
      this.charge = Math.min(1, this.charge + dt / 1.1);
      cords.rotation.z += dt * (6 + 30 * this.charge);
      const now = performance.now();
      if (now - this.lastPulse > 80) {
        this.lastPulse = now;
        this.pulse(dom, 0.05 + 0.25 * this.charge, 50);
      }
    } else if (this.charge > 0) {
      if (this.charge >= WEAPONS.sling.minPower) {
        _origin.set(0, -0.45, -0.07);
        model.updateMatrixWorld(true);
        model.localToWorld(_origin);
        model.getWorldQuaternion(_q);
        _aim.set(0, 0, -1).applyQuaternion(_q);
        session.send({ t: 'fire', o: [_origin.x, _origin.y, _origin.z], d: [_aim.x, _aim.y, _aim.z], p: this.charge });
        this.cooldown = WEAPONS.sling.cooldown;
        this.pulse(dom, 0.8, 90);
      }
      this.charge = 0;
      cords.rotation.z = 0;
    }
  }

  // ---- cuerpo a cuerpo
  /** Cápsulas de los posibles objetivos (jugadores remotos y muñecos de entrenamiento). */
  targetCapsules() {
    const list = [];
    const { session, dummies } = this.game;
    for (const a of session.remote.avatars.values()) {
      if (!a.group.visible || !a.alive) continue;
      list.push([new THREE.Vector3(a.pos.x, 0.3, a.pos.z), new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z)]);
    }
    for (const d of dummies ?? []) list.push([new THREE.Vector3(d.x, 0.2, d.z), new THREE.Vector3(d.x, 1.62, d.z)]);
    return list;
  }

  updateMelee(dt, id, dom) {
    const { session, audio } = this.game;
    const w = WEAPONS[id];
    const model = this.held?.obj;
    if (!model) return;
    model.updateMatrixWorld(true);
    _base.set(0, 0, 0.05);
    model.localToWorld(_base);
    _tip.set(0, 0, model.userData.tipZ * 0.95);
    model.localToWorld(_tip);
    const tipSpeed = dom.userData.vel.length() + 0.9 * this.angularSpeed(dom, dt);
    if (this.cooldown > 0 || tipSpeed < SWING_MIN_SPEED) return;

    // solo cuenta como golpe si la hoja pasa cerca de alguien
    let near = false;
    const info = { s: 0, t: 0 };
    for (const [a, b] of this.targetCapsules()) {
      if (segSegDist2(_base, _tip, a, b, info) < 0.5 * 0.5) {
        near = true;
        break;
      }
    }
    if (!near) return;
    const d = _tip.clone().sub(_base).normalize();
    session.send({ t: 'melee', o: [_base.x, _base.y, _base.z], d: [d.x, d.y, d.z], v: THREE.MathUtils.clamp(tipSpeed / 4, 0.6, 1.3) });
    audio.playGlobal('swing', 0.7, 0.9 + Math.random() * 0.2);
    this.cooldown = w.cooldown * 0.8;
    this.pulse(dom, 0.9, 110);
  }

  /** Velocidad angular aproximada de la mano (rad/s) a partir del cambio de orientación. */
  angularSpeed(c, dt) {
    c.getWorldQuaternion(_q);
    const prev = c.userData.lastQuat ?? _q.clone();
    const angle = 2 * Math.acos(Math.min(1, Math.abs(prev.dot(_q))));
    c.userData.lastQuat = _q.clone();
    return angle / Math.max(dt, 1e-3);
  }

  // ---- lanzar hacha / lanza
  updateThrow(dt, id, dom) {
    const { session, audio } = this.game;
    const w = WEAPONS[id];
    const wasPressed = this.prevPressed;
    const pressed = dom.userData.pressed;
    if (!pressed && wasPressed && this.cooldown === 0) {
      // velocidad máxima de la mano en los últimos instantes antes de soltar
      const v = new THREE.Vector3();
      let best = 0;
      for (const h of dom.userData.hist.filter((e) => this.time - e.t < 0.2)) {
        const sp = h.v.length();
        if (sp > best) {
          best = sp;
          v.copy(h.v);
        }
      }
      const speed = v.length();
      if (speed >= 2.0) {
        dom.getWorldPosition(_origin);
        const dir = v.normalize();
        session.send({
          t: 'throw', o: [_origin.x, _origin.y, _origin.z], d: [dir.x, dir.y, dir.z], p: THREE.MathUtils.clamp(speed / (w.throwSpeed * 0.8), 0.4, 1),
        });
        audio.playGlobal('swing', 0.8, 0.8);
        this.cooldown = 0.4;
        this.pulse(dom, 0.7, 100);
      }
    }
  }

  // ----------------------------------------------------------------------- pose para los demás
  sendPose(id, dom, off, wp) {
    const { camera, session } = this.game;
    camera.getWorldPosition(_head);
    camera.getWorldQuaternion(_q);
    let weaponPose = wp;
    if (!weaponPose && this.held) {
      this.held.obj.updateWorldMatrix(true, false);
      weaponPose = {
        pos: this.held.obj.getWorldPosition(new THREE.Vector3()),
        quat: this.held.obj.getWorldQuaternion(new THREE.Quaternion()),
        aux: this.charge,
      };
    }
    const hp = (c, fallback) => {
      if (!c) return fallback;
      const p = c.getWorldPosition(new THREE.Vector3());
      return [p.x, p.y, p.z];
    };
    session.send({
      t: 'pose',
      h: [_head.x, _head.y, _head.z, _q.x, _q.y, _q.z, _q.w],
      w: weaponPose ? id : null,
      wp: weaponPose
        ? [weaponPose.pos.x, weaponPose.pos.y, weaponPose.pos.z, weaponPose.quat.x, weaponPose.quat.y, weaponPose.quat.z, weaponPose.quat.w]
        : [0, 0, 0, 0, 0, 0, 1],
      a: weaponPose?.aux ?? 0,
      lh: hp(off, [_head.x - 0.3, _head.y - 0.5, _head.z]),
      rh: hp(dom, [_head.x + 0.3, _head.y - 0.5, _head.z]),
    });
  }

  // ----------------------------------------------------------------------- mandos: stick y botones
  pollGamepads(dt) {
    const { renderer, camera, rig, session, collision } = this.game;
    const xrSession = renderer.xr.getSession();
    if (!xrSession) return;

    let mx = 0;
    let my = 0;
    let turn = 0;
    let jumpPush = 0; // stick derecho hacia delante = saltar
    const pads = [...xrSession.inputSources].filter((src) => src.gamepad && !src.hand);
    pads.forEach((src) => {
      const gp = src.gamepad;
      const ix = gp.axes.length >= 4 ? 2 : 0; // xr-standard: stick en 2..3; solo touchpad: 0..1
      const sx = deadzone(gp.axes[ix] ?? 0);
      const sy = deadzone(gp.axes[ix + 1] ?? 0);
      const right = src.handedness === 'right' || (src.handedness !== 'left' && src === pads[1]);
      if (pads.length === 1) {
        my = sy;
        turn = sx;
      } else if (right) {
        turn = sx;
        jumpPush = sy;
      } else {
        mx = sx;
        my = sy;
      }

      const hasFace = gp.buttons.length > 5;
      const a = hasFace ? !!gp.buttons[4]?.pressed : false; // A / X: cambiar de arma
      const b = hasFace ? !!gp.buttons[5]?.pressed : false; // B / Y: lanzar <-> cuerpo a cuerpo
      const click = !!(gp.buttons[3] ?? (hasFace ? null : gp.buttons[2]))?.pressed; // clic del stick/touchpad
      const prev = this.prevButtons.get(src) ?? { a: false, b: false, click: false };
      if (a && !prev.a) session.cycle(1);
      if (b && !prev.b) session.toggleMode();
      if (click && !prev.click) {
        if (!hasFace) session.cycle(1); // visores sin A/B: el clic cambia de arma
        else if (right || pads.length === 1) session.drop();
        else this.game.collect?.();
      }
      this.prevButtons.set(src, { a, b, click });
    });

    // giro a saltos: rota el rig alrededor de la cabeza
    if (Math.abs(turn) > 0.7 && this.snapReady) {
      this.snapReady = false;
      const angle = turn > 0 ? -SNAP_ANGLE : SNAP_ANGLE;
      rig.updateMatrixWorld(true);
      camera.getWorldPosition(_head);
      const dx = rig.position.x - _head.x;
      const dz = rig.position.z - _head.z;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      rig.position.x = _head.x + dx * cos + dz * sin;
      rig.position.z = _head.z - dx * sin + dz * cos;
      rig.rotation.y += angle;
    } else if (Math.abs(turn) < 0.3) {
      this.snapReady = true;
    }

    rig.updateMatrixWorld(true);
    const mag = Math.min(1, Math.hypot(mx, my));
    if (session.alive && mag > 0) {
      camera.getWorldDirection(_move);
      _move.y = 0;
      _move.normalize();
      _right.crossVectors(_move, UP);
      // andar proporcional a cuánto empujas el stick; a fondo, correr
      const speed = WALK_SPEED * mag + (RUN_SPEED - WALK_SPEED) * THREE.MathUtils.smoothstep(mag, 0.75, 1);
      const dir = _hand.set(mx, 0, my).normalize();
      rig.position.addScaledVector(_move, -dir.z * speed * dt).addScaledVector(_right, dir.x * speed * dt);
    }

    // mantiene la cabeza dentro de la zona de juego y fuera de los muros
    rig.updateMatrixWorld(true);
    camera.getWorldPosition(_head);
    _hand.copy(_head);
    collision.apply(_hand, rig.position.y);
    rig.position.x += _hand.x - _head.x;
    rig.position.z += _hand.z - _head.z;

    // salto y caída; el suelo se desplaza con el rig (la cabeza física sigue a tu altura real)
    this.body.y = rig.position.y;
    stepVertical(this.body, dt, (feet) => collision.support(_hand, feet), session.alive && jumpPush < -0.75);
    rig.position.y = this.body.y;
  }
}
