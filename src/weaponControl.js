import * as THREE from 'three';
import { WEAPONS, selectedWeapon, primaryAction } from '../shared/weapons.js';
import { BRACE, MAX_DRAW } from './physics.js';
import { createWeaponModel } from './weaponModels.js';

const BOW_DRAW_TIME = 1.0;
const SLING_CHARGE_TIME = 1.1;
const THROW_CHARGE_TIME = 0.7;
const HOLD_TO_THROW = 0.2; // hacha: pulsación más corta = golpe; mantener más = preparar el lanzamiento
const CONVERGE = 30; // m: la flecha cruza la línea de la mira a esta distancia (paralaje del arma)
const SWING = { sword: 1.15, axe: 0.55, spear: 0.46 }; // duración del golpe (s)
// momentos de impacto (fracción del golpe). La espada corta dos veces en X: los impactos van separados
// más que su cadencia en el servidor (0,55 s) para que cuenten los dos
const HITS = { sword: [0.2, 0.74] };
const DEFAULT_HITS = [0.45];
// espada: un clic = solo el 1er corte y vuelve a la guardia; un 2º clic a tiempo encadena la X completa
const SWORD_FIRST_END = 0.28; // fracción del golpe en la que acaba el 1er corte
const SWORD_RECOVER = 0.3; // s para volver a la guardia tras un solo corte
const SWORD_COMBO_GRACE = 0.4; // el 2º clic aún encadena en el primer 40 % de la vuelta a la guardia

const E = (x, y, z) => new THREE.Euler(x, y, z);
// los modelos de hacha y espada tienen el filo hacia +X: se giran sobre el mango para que el filo mire al frente
const AXE_EDGE_FWD = -Math.PI / 2;
// hacha y espada se sostienen cruzadas en diagonal: mango abajo a la izquierda, cabeza/hoja arriba a la derecha
const AXE_ROLL = -0.5;
const SWORD_ROLL = -0.5;
const AXE_ROLL_THROW = -0.7; // al cargar el lanzamiento la cabeza se va arriba a la derecha (sobre el hombro)
const _axeRoll = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const P = (x, y, z) => new THREE.Vector3(x, y, z);
// pose de reposo de cada arma, en el espacio de la cámara
const IDLE = {
  sword: { pos: P(0.2, -0.36, -0.62), rot: E(1.0, 0.1, AXE_EDGE_FWD - 0.6) },
  axe: { pos: P(0.2, -0.55, -0.55), rot: E(1.15, 0.1, AXE_EDGE_FWD - 0.6) },
  spear: { pos: P(0.3, -0.36, -0.35), rot: E(0.06, 0.1, 0) },
  crossbow: { pos: P(0.22, -0.27, -0.6), rot: E(0.02, 0.0, 0) },
  sling: { pos: P(0.3, -0.2, -0.4), rot: E(1.0, 0, 0) },
};

/** Orientación (espacio de la cámara) con la hoja hacia `blade` y el filo hacia `edge` (modelo: hoja -Z, filo +X). */
function bladePose(blade, edge) {
  const z = blade.clone().normalize().negate();
  const x = edge.clone().addScaledVector(z, -edge.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// tajo de espada en X como en la vida real. Cada corte es diagonal: la hoja gira en un plano inclinado ~30°
// respecto a la vertical (de arriba sobre el hombro hacia abajo y al frente) y golpea de frente, con el filo por delante.
// [u final del tramo, posición, orientación, curva]
const smooth = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const linear = (t) => t;
/**
 * Orientación de la hoja dentro del plano del corte diagonal. `phi` (grados) recorre el corte:
 * -140 = armada sobre el hombro, ~0 = impacto apuntando al frente (filo abajo y adelante), 70 = acabado abajo.
 * `mirror` = segundo corte de la X (de arriba a la izquierda hacia abajo a la derecha).
 */
function cutPose(phi, mirror = false) {
  const a = THREE.MathUtils.degToRad(phi);
  const d = P(mirror ? 0.5 : -0.5, -0.866, 0); // dirección del corte en pantalla (30° desde la vertical)
  const f = P(0, 0, -1);
  const blade = f.clone().multiplyScalar(Math.cos(a)).addScaledVector(d, Math.sin(a));
  const edge = f.clone().multiplyScalar(-Math.sin(a)).addScaledVector(d, Math.cos(a)); // el filo va por delante
  return bladePose(blade, edge);
}
// la mano baja en diagonal; el segundo corte es el espejo del primero (alrededor de x = 0.09, la mano derecha)
const cutHand = (x, y, z, mirror) => P(mirror ? 0.18 - x : x, y, z);
const CUT_KEYS = (mirror) => [
  [cutHand(0.3, 0.14, -0.4, mirror), cutPose(-140, mirror), smooth], // armar sobre el hombro
  [cutHand(0.22, 0.04, -0.52, mirror), cutPose(-70, mirror), easeIn], // arranca el corte
  [cutHand(0.12, -0.12, -0.62, mirror), cutPose(-5, mirror), linear], // impacto, de frente
  [cutHand(0.02, -0.38, -0.55, mirror), cutPose(70, mirror), easeOut], // acabar el corte abajo
];
const SWORD_CUT = [
  [0, IDLE.sword.pos, new THREE.Quaternion().setFromAxisAngle(P(0, 0, 1), SWORD_ROLL).multiply(new THREE.Quaternion().setFromEuler(IDLE.sword.rot))], // guardia
  ...[0.12, 0.17, 0.2, 0.28].map((u, i) => [u, ...CUT_KEYS(false)[i]]), // 1er corte: arriba derecha → abajo izquierda
  ...[0.6, 0.69, 0.74, 0.84].map((u, i) => [u, ...CUT_KEYS(true)[i]]), // 2º corte: arriba izquierda → abajo derecha
  [1, null, null, smooth], // volver a la guardia
];
SWORD_CUT[SWORD_CUT.length - 1][1] = SWORD_CUT[0][1];
SWORD_CUT[SWORD_CUT.length - 1][2] = SWORD_CUT[0][2];
const _swingQ = new THREE.Quaternion();

const BOW_REST = { pos: P(0.4, -0.38, -0.95), rot: E(0.04, 0.3, -0.16) };
const BOW_DRAWN = { pos: P(-0.12, -0.1, -1.0), rot: E(0, 0, 0) };
const BOW_SCALE = 0.8;
const VIEW_SCALE = { crossbow: 0.8, axe: 0.9 };

function catmullRom(a, b, c, d, t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return out.set(f(a.x, b.x, c.x, d.x), f(a.y, b.y, c.y, d.y), f(a.z, b.z, c.z, d.z));
}
const lerpV = (a, b, t, out) => out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const _origin = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _v = new THREE.Vector3();

// estela de la espada: solo durante los dos cortes de la X (fracciones del golpe)
const TRAIL_PHASES = [[0.14, 0.3], [0.62, 0.86]];
const TRAIL_SAMPLES = 20;
const TRAIL_LIFE = 0.1; // s que tarda en desvanecerse cada tramo
const HIT_STOP = 0.035; // fracción del golpe tras cada impacto que va a cámara lenta (da peso al corte)

/** Cinta brillante entre la base y la punta de la hoja, que se desvanece detrás del corte. */
class BladeTrail {
  constructor(parent) {
    this.samples = []; // { base, tip, age }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3));
    const index = [];
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  update(dt, base, tip) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > TRAIL_LIFE) this.samples.shift();
    if (base) {
      this.samples.push({ base: base.clone(), tip: tip.clone(), age: 0 });
      if (this.samples.length > TRAIL_SAMPLES) this.samples.shift();
    }
    const n = this.samples.length;
    this.mesh.visible = n >= 2;
    if (!this.mesh.visible) return;
    const pos = this.mesh.geometry.attributes.position;
    const col = this.mesh.geometry.attributes.color;
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const k = i < n ? Math.max(0, 1 - s.age / TRAIL_LIFE) * (i / (n - 1)) : 0;
      pos.setXYZ(i * 2, s.base.x, s.base.y, s.base.z);
      pos.setXYZ(i * 2 + 1, s.tip.x, s.tip.y, s.tip.z);
      // la base casi no brilla; la punta deja el trazo más claro (tono acero frío)
      col.setXYZ(i * 2, 0, 0, 0);
      col.setXYZ(i * 2 + 1, 0.16 * k, 0.19 * k, 0.22 * k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  clear() {
    this.samples.length = 0;
    this.mesh.visible = false;
  }
}

/** Lógica y animación del arma en primera persona (teclado y ratón). */
export class DesktopWeapons {
  constructor({ camera, bow, session, audio }) {
    this.camera = camera;
    this.bow = bow;
    this.session = session;
    this.audio = audio;
    this.holder = new THREE.Group();
    camera.add(this.holder);
    this.trail = new BladeTrail(this.holder);
    this.models = new Map();
    this.current = null; // id del arma visible
    this.currentObj = null;
    this.charge = 0; // arco / honda / lanzamiento, 0..1
    this.charging = false;
    this.swingT = -1; // <0: sin golpe en curso
    this.holdT = -1; // hacha: tiempo con el clic mantenido (<0: sin pulsar)
    this.combo = false; // espada: se pidió el 2º corte
    this.recoverT = -1; // espada: vuelta a la guardia tras un solo corte (0..1, <0: no)
    this.swingSent = 0;
    this.cooldown = 0;
    this.loaded = true; // ballesta
    this.equipT = 1;
    this.prevPrimary = false;
    this.time = 0;
    this.zoom = false;
    this.warnedAmmo = 0;
  }

  /** Vuelve a colgar el arma de la cámara (tras salir de VR). */
  rebind() {
    if (this.currentObj) this.holder.remove(this.currentObj);
    this.current = null;
    this.currentObj = null;
  }

  get zoomWanted() {
    const id = selectedWeapon(this.session.inv);
    return this.zoom && id && WEAPONS[id].slot === 'ranged';
  }

  modelFor(id) {
    if (id === 'bow') return this.bow.group;
    if (!this.models.has(id)) this.models.set(id, createWeaponModel(id));
    return this.models.get(id);
  }

  setCurrent(id) {
    if (id === this.current) return;
    if (this.currentObj) this.holder.remove(this.currentObj);
    this.current = id;
    this.currentObj = id ? this.modelFor(id) : null;
    if (this.currentObj) {
      this.holder.add(this.currentObj);
      this.currentObj.scale.setScalar(id === 'bow' ? BOW_SCALE : VIEW_SCALE[id] ?? 1);
    }
    this.charge = 0;
    this.charging = false;
    this.swingT = -1;
    this.holdT = -1;
    this.combo = false;
    this.recoverT = -1;
    this.trail.clear();
    this.equipT = 0;
    if (id === 'crossbow') this.loaded = this.session.inv.ammo > 0 || this.session.infinite;
    if (id === 'bow') this.bow.setNock(BRACE);
  }

  /** input: { primary: boolean (botón principal mantenido), zoom: boolean } */
  update(dt, input) {
    this.time += dt;
    const s = this.session;
    const id = s.alive ? selectedWeapon(s.inv) : null;
    this.setCurrent(id);
    this.holder.visible = !!id;
    this.zoom = input.zoom;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.equipT = Math.min(1, this.equipT + dt / 0.25);
    const pressed = input.primary && !this.prevPrimary;
    this.prevPrimary = input.primary;
    if (!id) return;

    const w = WEAPONS[id];
    const action = primaryAction(s.inv);
    if (action === 'ranged') this.updateRanged(dt, id, w, input, pressed);
    else if (action === 'throw' && w.hitAndThrow) this.updateHitAndThrow(dt, id, w, input, pressed);
    else if (action === 'throw') this.updateThrow(dt, id, w, input);
    else this.updateMelee(dt, id, w, pressed);
    this.applyPose(dt, id, action);
  }

  // ------------------------------------------------------------------ distancia
  haveAmmo() {
    const s = this.session;
    return s.infinite || s.inv.ammo > 0;
  }

  warnNoAmmo() {
    if (this.time - this.warnedAmmo > 1.5) {
      this.warnedAmmo = this.time;
      this.session.hooks.toast?.('Sin munición');
    }
  }

  updateRanged(dt, id, w, input, pressed) {
    const ready = this.cooldown === 0;
    if (id === 'bow') {
      if (input.primary && ready) {
        if (!this.haveAmmo()) {
          if (pressed) this.warnNoAmmo();
          return;
        }
        if (!this.charging) {
          this.charging = true;
          this.audio.nock();
        }
        this.charge = Math.min(1, this.charge + dt / BOW_DRAW_TIME);
        this.bow.setNock(BRACE + MAX_DRAW * this.charge);
      } else if (this.charging) {
        this.releaseBow();
      } else {
        this.charge = Math.max(0, this.charge - dt * 4);
      }
      this.bow.setArrowVisible(ready && this.haveAmmo());
    } else if (id === 'crossbow') {
      const model = this.currentObj;
      if (!this.loaded && this.cooldown === 0 && this.haveAmmo()) {
        this.loaded = true;
        this.audio.nock();
      }
      model.userData.setLoaded(this.loaded && this.haveAmmo());
      if (pressed && ready && this.loaded) {
        if (!this.haveAmmo()) return this.warnNoAmmo();
        model.updateMatrixWorld(true);
        _origin.set(0, 0.06, -0.45);
        model.localToWorld(_origin);
        this.fire(_origin, 1);
        this.loaded = false;
        this.cooldown = w.cooldown;
      }
    } else if (id === 'sling') {
      const model = this.currentObj;
      model.userData.setStoneVisible(this.haveAmmo());
      if (input.primary && ready) {
        if (!this.haveAmmo()) {
          if (pressed) this.warnNoAmmo();
          return;
        }
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt / SLING_CHARGE_TIME);
        model.userData.cords.rotation.z += dt * (6 + 30 * this.charge);
      } else if (this.charging) {
        this.charging = false;
        if (this.charge >= w.minPower) {
          this.camera.getWorldPosition(_origin);
          this.camera.getWorldDirection(_fwd);
          _origin.addScaledVector(_fwd, 0.55).y -= 0.08;
          this.fire(_origin, this.charge);
          this.cooldown = w.cooldown;
        }
        this.charge = 0;
        model.userData.cords.rotation.z = 0;
      }
    }
  }

  releaseBow() {
    const p = this.charge;
    this.charging = false;
    this.charge = 0;
    if (p < 0.12) {
      this.bow.setNock(BRACE);
      return;
    }
    this.bow.group.updateMatrixWorld(true);
    this.bow.arrow.getWorldPosition(_origin);
    this.fire(_origin, p);
    this.bow.release();
    this.cooldown = WEAPONS.bow.cooldown;
  }

  fire(origin, power) {
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldDirection(_fwd);
    _dir.copy(_cam).addScaledVector(_fwd, CONVERGE).sub(origin).normalize();
    this.session.send({ t: 'fire', o: [origin.x, origin.y, origin.z], d: [_dir.x, _dir.y, _dir.z], p: power });
  }

  // ------------------------------------------------------------------ cuerpo a cuerpo
  updateMelee(dt, id, w, pressed) {
    const dur = SWING[id] ?? 0.45;
    if (this.swingT < 0) {
      if (pressed && this.cooldown === 0) {
        this.swingT = 0;
        this.swingSent = 0; // impactos ya enviados
        this.combo = false;
        this.recoverT = -1;
        this.cooldown = w.cooldown;
        this.audio.playGlobal('swing', 0.7, 0.9 + Math.random() * 0.2);
      }
      return;
    }
    if (id === 'sword' && this.updateSwordCombo(dt, pressed)) return;
    const prevT = this.swingT;
    const hits = HITS[id] ?? DEFAULT_HITS;
    // justo después de cada impacto la hoja se frena un instante, como al cortar algo
    const slow = id === 'sword' && hits.some((h) => prevT >= h && prevT < h + HIT_STOP) ? 0.3 : 1;
    this.swingT += (dt * slow) / dur;
    // en la X, el segundo corte vuelve a sonar al empezar a bajar
    if (id === 'sword' && prevT < 0.6 && this.swingT >= 0.6) this.audio.playGlobal('swing', 0.7, 0.9 + Math.random() * 0.2);
    if (this.swingSent < hits.length && this.swingT >= hits[this.swingSent]) {
      this.swingSent++;
      this.camera.getWorldPosition(_cam);
      this.camera.getWorldDirection(_fwd);
      this.session.send({ t: 'melee', o: [_cam.x, _cam.y - 0.12, _cam.z], d: [_fwd.x, _fwd.y, _fwd.z], v: 1 });
    }
    if (this.swingT >= 1) this.swingT = -1;
  }

  /**
   * Espada: decide entre un solo corte y la X. Devuelve true si este fotograma ya está resuelto
   * (volviendo a la guardia tras un solo corte).
   */
  updateSwordCombo(dt, pressed) {
    if (pressed && !this.combo) {
      if (this.swingT < SWORD_FIRST_END) this.combo = true;
      else if (this.recoverT >= 0 && this.recoverT < SWORD_COMBO_GRACE) {
        // 2º clic justo al empezar a volver: se retoma la X desde el final del 1er corte
        this.combo = true;
        this.recoverT = -1;
        this.swingT = SWORD_FIRST_END;
      }
    }
    if (this.recoverT >= 0) {
      this.recoverT += dt / SWORD_RECOVER;
      if (this.recoverT >= 1) {
        this.recoverT = -1;
        this.swingT = -1;
      }
      return true;
    }
    if (!this.combo && this.swingT >= SWORD_FIRST_END) {
      this.swingT = SWORD_FIRST_END;
      this.recoverT = 0;
      return true;
    }
    return false;
  }

  /** Hacha: un clic corto golpea; mantener el clic prepara el lanzamiento y al soltar se lanza. */
  updateHitAndThrow(dt, id, w, input, pressed) {
    if (this.swingT >= 0) return this.updateMelee(dt, id, w, false);
    if (pressed) this.holdT = 0;
    if (input.primary && this.holdT >= 0) {
      this.holdT += dt;
      if (this.holdT < HOLD_TO_THROW) return;
    } else if (this.holdT >= 0 && this.holdT < HOLD_TO_THROW) {
      // soltó antes de cargar: es un golpe
      this.holdT = -1;
      return this.updateMelee(dt, id, w, true);
    } else {
      this.holdT = -1;
    }
    this.updateThrow(dt, id, w, input);
  }

  // ------------------------------------------------------------------ lanzar hacha / lanza
  updateThrow(dt, id, w, input) {
    if (input.primary && this.cooldown === 0) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + dt / THROW_CHARGE_TIME);
    } else if (this.charging) {
      this.charging = false;
      this.camera.getWorldPosition(_cam);
      this.camera.getWorldDirection(_fwd);
      _origin.copy(_cam).addScaledVector(_fwd, 0.4);
      _origin.y -= 0.1;
      this.session.send({
        t: 'throw', o: [_origin.x, _origin.y, _origin.z], d: [_fwd.x, _fwd.y + 0.04, _fwd.z], p: Math.max(0.4, this.charge),
      });
      this.audio.playGlobal('swing', 0.8, 0.8);
      this.charge = 0;
      this.cooldown = 0.4;
    } else {
      this.charge = Math.max(0, this.charge - dt * 4);
    }
  }

  // ------------------------------------------------------------------ pose en pantalla
  applyPose(dt, id, action) {
    const obj = this.currentObj;
    if (!obj) return;
    const pos = obj.position;
    const rot = obj.rotation;
    if (id === 'bow') {
      const k = smooth(this.charge);
      lerpV(BOW_REST.pos, BOW_DRAWN.pos, k, pos);
      rot.set(
        THREE.MathUtils.lerp(BOW_REST.rot.x, BOW_DRAWN.rot.x, k),
        THREE.MathUtils.lerp(BOW_REST.rot.y, BOW_DRAWN.rot.y, k),
        THREE.MathUtils.lerp(BOW_REST.rot.z, BOW_DRAWN.rot.z, k)
      );
    } else {
      const idle = IDLE[id];
      pos.copy(idle.pos);
      rot.copy(idle.rot);
      if (this.swingT >= 0) this.swingPose(id, this.swingT, pos, rot);
      if (action === 'throw' && id === 'axe') {
        // se lleva hacia atrás por encima del hombro derecho, sin acercarse a la cámara
        const c = smooth(this.charge);
        pos.x -= 0.02 * c;
        pos.y += 0.2 * c;
        pos.z -= 0.05 * c;
        rot.x += 0.25 * c;
      } else if (action === 'throw') {
        const c = smooth(this.charge);
        pos.y += 0.2 * c;
        pos.z += 0.15 * c;
        rot.x += 0.5 * c;
      }
      if (id === 'crossbow') {
        const z = this.zoomWanted ? 1 : 0;
        pos.x = THREE.MathUtils.lerp(IDLE.crossbow.pos.x, 0.0, z);
        pos.y = THREE.MathUtils.lerp(IDLE.crossbow.pos.y, -0.17, z);
        if (!this.loaded) pos.z += 0.03 * Math.sin(this.time * 30) * Math.max(0, this.cooldown);
      }
      if (id === 'sling') {
        const c = this.charge;
        pos.x = THREE.MathUtils.lerp(0.3, 0.1, c);
        pos.y = THREE.MathUtils.lerp(-0.2, 0.0, c);
      }
    }
    if (id === 'axe') {
      const roll = action === 'throw' ? THREE.MathUtils.lerp(AXE_ROLL, AXE_ROLL_THROW, smooth(this.charge)) : AXE_ROLL;
      obj.quaternion.premultiply(_axeRoll.setFromAxisAngle(_zAxis, roll));
    } else if (id === 'sword' && this.swingT < 0) {
      obj.quaternion.premultiply(_axeRoll.setFromAxisAngle(_zAxis, SWORD_ROLL)); // el tajo usa su propia pose
    }
    // sacar el arma: sube desde abajo
    pos.y -= 0.45 * (1 - smooth(this.equipT));
    // vaivén sutil al respirar
    pos.y += Math.sin(this.time * 1.7) * 0.003;
    this.updateTrail(dt, id, obj);
  }

  /** Estela de la espada en los cortes (en el espacio de la cámara, como el arma). */
  updateTrail(dt, id, obj) {
    const u = this.swingT;
    const cutting = id === 'sword' && u >= 0 && this.recoverT < 0 && TRAIL_PHASES.some(([a, b]) => u >= a && u <= b);
    if (!cutting) return this.trail.update(dt, null, null);
    obj.updateMatrix();
    const tipZ = obj.userData.tipZ ?? -0.9;
    const tip = _v.set(0, 0, tipZ * 0.98).applyMatrix4(obj.matrix);
    const base = _origin.set(0, 0, tipZ * 0.7).applyMatrix4(obj.matrix);
    this.trail.update(dt, base, tip);
  }

  swingPose(id, u, pos, rot) {
    const e = smooth(Math.min(1, u * 1.15));
    const back = Math.sin(Math.PI * Math.min(1, u)); // 0 → 1 → 0
    if (id === 'sword' && this.recoverT >= 0) {
      // un solo corte: del final del 1er corte de vuelta a la guardia
      const end = SWORD_CUT.find((k) => k[0] === SWORD_FIRST_END);
      const [, guardPos, guardQ] = SWORD_CUT[0];
      const k = smooth(this.recoverT);
      lerpV(end[1], guardPos, k, pos);
      rot.setFromQuaternion(_swingQ.slerpQuaternions(end[2], guardQ, k));
    } else if (id === 'sword') {
      const t = Math.min(1, u);
      let i = 1;
      while (i < SWORD_CUT.length - 1 && t > SWORD_CUT[i][0]) i++;
      const [u0, p0, q0] = SWORD_CUT[i - 1];
      const [u1, p1, q1, ease] = SWORD_CUT[i];
      const k = ease((t - u0) / (u1 - u0));
      // la mano recorre arcos (Catmull-Rom entre las posiciones clave), no líneas rectas
      const pa = SWORD_CUT[Math.max(0, i - 2)][1];
      const pb = SWORD_CUT[Math.min(SWORD_CUT.length - 1, i + 1)][1];
      catmullRom(pa, p0, p1, pb, k, pos);
      rot.setFromQuaternion(_swingQ.slerpQuaternions(q0, q1, k));
    } else if (id === 'axe') {
      pos.set(THREE.MathUtils.lerp(0.25, 0.1, e), THREE.MathUtils.lerp(0.15, -0.42, e), -0.45 - 0.35 * back);
      rot.set(THREE.MathUtils.lerp(2.2, 0.15, e), 0.1, AXE_EDGE_FWD);
    } else if (id === 'spear') {
      pos.z = IDLE.spear.pos.z - 0.6 * back;
      pos.y += 0.05 * back;
    }
  }

  /** Pose del arma en el mundo para enviarla a los demás jugadores. */
  worldPose() {
    const obj = this.currentObj;
    if (!obj || !this.holder.visible) return null;
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    obj.getWorldPosition(p);
    obj.getWorldQuaternion(q);
    return { id: this.current, pos: p, quat: q, aux: this.charging || this.charge > 0 ? this.charge : 0 };
  }

  /** Posición para el hint de recoger objetos. */
  headPosition(out = _v) {
    return this.camera.getWorldPosition(out);
  }
}
