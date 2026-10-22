import * as THREE from 'three';
import { stepProjectile, FIXED_DT } from '../shared/physics.js';
import { createProjectileMesh } from './weaponModels.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const SPIN_AXIS = new THREE.Vector3(1, 0, 0);
const WHOOSH_TYPES = ['arrow', 'bolt', 'spear'];

const _dq = new THREE.Quaternion();
const _spinQ = new THREE.Quaternion();
const _dir = new THREE.Vector3();

/**
 * Dibuja los proyectiles en vuelo. Usa el mismo integrador y paso fijo que la simulación del servidor,
 * de modo que la trayectoria coincide; el punto de impacto lo decide siempre el servidor (proj_end).
 */
export class ProjectileView {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.flying = new Map();
    this.acc = 0;
  }

  spawn(m) {
    const mesh = createProjectileMesh(m.type);
    this.scene.add(mesh);
    const pos = V(m.o);
    const vel = V(m.v);
    const dir = vel.clone().normalize();
    mesh.quaternion.setFromUnitVectors(FORWARD, dir);
    mesh.position.copy(pos);
    this.flying.set(m.id, {
      type: m.type, mesh, pos, prev: pos.clone(), vel, wind: V(m.w ?? [0, 0, 0]), dir, orient: mesh.quaternion.clone(),
      spin: 0, age: 0, whoosh: WHOOSH_TYPES.includes(m.type) ? this.audio.startWhoosh(mesh) : null,
    });
  }

  end(id) {
    const f = this.flying.get(id);
    if (!f) return;
    this.audio.stopWhoosh(f.whoosh);
    f.mesh.removeFromParent();
    this.flying.delete(id);
  }

  update(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= FIXED_DT) {
      this.acc -= FIXED_DT;
      for (const [id, f] of this.flying) {
        f.prev.copy(f.pos);
        stepProjectile(f.type, f.pos, f.vel, FIXED_DT, f.wind);
        _dir.copy(f.vel).normalize();
        f.orient.premultiply(_dq.setFromUnitVectors(f.dir, _dir)); // conserva el giro (roll) del asta
        f.dir.copy(_dir);
        f.age += FIXED_DT;
        if (f.type === 'axe') f.spin -= 17 * FIXED_DT; // giro hacia delante (por encima), con el filo por delante
        if (f.age > 20) this.end(id);
      }
    }
    const alpha = this.acc / FIXED_DT;
    for (const f of this.flying.values()) {
      f.mesh.position.lerpVectors(f.prev, f.pos, alpha);
      f.mesh.quaternion.copy(f.orient);
      if (f.type === 'axe') f.mesh.quaternion.multiply(_spinQ.setFromAxisAngle(SPIN_AXIS, f.spin));
    }
  }

  clear() {
    for (const id of [...this.flying.keys()]) this.end(id);
  }
}
