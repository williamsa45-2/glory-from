import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { createWeaponModel, createProjectileMesh, createStoneMesh, createBoltMesh, restQuaternion } from './weaponModels.js';
import { createArrowMesh } from './bow.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Q = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const ringGeo = new THREE.RingGeometry(0.34, 0.4, 28).rotateX(-Math.PI / 2);
const ringMats = {
  weapon: new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.7, depthWrite: false }),
  ammo: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7, depthWrite: false }),
};

/** Objetos del suelo: armas soltas/lanzadas, munición clavada, piedras y las armas del armero. */
export class ItemView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map();
    this.time = 0;
  }

  add(item) {
    if (this.items.has(item.id)) this.remove(item.id);
    const isWeapon = !!WEAPONS[item.type];
    let mesh;
    let ring = null;
    const pos = V(item.pos);
    if (item.stuck && (item.type === 'arrow' || item.type === 'bolt' || item.type === 'axe' || item.type === 'spear')) {
      mesh = createProjectileMesh(item.type);
      mesh.position.copy(pos);
      mesh.quaternion.copy(Q(item.quat));
    } else if (isWeapon) {
      mesh = new THREE.Group();
      const model = createWeaponModel(item.type);
      const yaw = Q(item.quat);
      model.quaternion.copy(restQuaternion(item.type, item.rack));
      mesh.add(model);
      mesh.position.copy(pos);
      mesh.quaternion.copy(item.rack ? new THREE.Quaternion() : yaw);
      if (!item.rack) {
        ring = new THREE.Mesh(ringGeo, ringMats.weapon);
        ring.position.set(pos.x, 0.02, pos.z);
        this.group.add(ring);
      }
    } else if (item.type === 'stone') {
      mesh = createStoneMesh();
      mesh.position.set(pos.x, 0.03, pos.z);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    } else {
      // paquete de flechas/virotes tumbados en el suelo
      mesh = new THREE.Group();
      const n = Math.max(1, item.count);
      for (let i = 0; i < n; i++) {
        const a = item.type === 'bolt' ? createBoltMesh() : createArrowMesh();
        a.position.set((i - (n - 1) / 2) * 0.05, 0.012 + i * 0.002, item.type === 'bolt' ? -0.2 : -0.39);
        a.rotation.y = (Math.random() - 0.5) * 0.15;
        mesh.add(a);
      }
      mesh.position.copy(pos);
      mesh.quaternion.copy(Q(item.quat));
      if (item.count > 1) {
        ring = new THREE.Mesh(ringGeo, ringMats.ammo);
        ring.position.set(pos.x, 0.02, pos.z);
        this.group.add(ring);
      }
    }
    mesh.traverse((o) => (o.castShadow = true));
    this.group.add(mesh);
    this.items.set(item.id, { item, mesh, ring, wobble: item.stuck ? 0.5 : 0, baseQuat: mesh.quaternion.clone() });
  }

  remove(id) {
    const e = this.items.get(id);
    if (!e) return;
    e.mesh.removeFromParent();
    e.ring?.removeFromParent();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** Objeto recogible más cercano (armas y munición) dentro de `maxDist` metros. */
  nearest(pos, maxDist, filter) {
    let best = null;
    let bestD = maxDist;
    const p = new THREE.Vector3();
    for (const e of this.items.values()) {
      if (filter && !filter(e.item)) continue;
      const d = pos.distanceTo(p.set(e.item.pos[0], e.item.pos[1] + 0.3, e.item.pos[2]));
      if (d < bestD) {
        bestD = d;
        best = e.item;
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    const pulse = 0.55 + 0.25 * Math.sin(this.time * 3);
    ringMats.weapon.opacity = pulse;
    ringMats.ammo.opacity = pulse;
    for (const e of this.items.values()) {
      if (e.wobble > 0) {
        e.wobble = Math.max(0, e.wobble - dt);
        const amp = 0.05 * Math.pow(e.wobble / 0.5, 2);
        e.mesh.quaternion.copy(e.baseQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(e.wobble * 70) * amp));
      }
    }
  }
}
