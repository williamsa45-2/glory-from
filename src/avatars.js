import * as THREE from 'three';
import { PLAYER_HP } from '../shared/weapons.js';
import { BRACE, MAX_DRAW } from './physics.js';
import { createWeaponModel } from './weaponModels.js';
import { textSprite } from './effects.js';
import { teamColor } from '../shared/teams.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function hueColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return new THREE.Color().setHSL(h / 360, 0.55, 0.45);
}

function setLimb(mesh, a, b) {
  const dir = _a.copy(b).sub(a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.8 });
const limbGeo = new THREE.CylinderGeometry(0.035, 0.03, 1, 6);

/** Jugador remoto: cabeza, torso, brazos hasta las manos reales (VR) y el arma que lleva. */
class Avatar {
  constructor(id, name, team = null) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.group = new THREE.Group();
    this.color = team == null ? hueColor(id) : new THREE.Color(teamColor(team));
    const cloth = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.85 });
    this.cloth = cloth;

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skinMat);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x6b727b, metalness: 0.8, roughness: 0.4 }));
    helm.position.y = 0.01;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eyes.position.set(0, 0.015, -0.125);
    this.head.add(skull, helm, eyes);
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.5, 4, 10), cloth);
    this.legs = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1, 10), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 }));
    this.handL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMat);
    this.handR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMat);
    this.armL = new THREE.Mesh(limbGeo, cloth);
    this.armR = new THREE.Mesh(limbGeo, cloth);
    for (const m of [this.head, this.torso, this.legs, this.handL, this.handR, this.armL, this.armR]) {
      m.traverse((o) => (o.castShadow = true));
      this.group.add(m);
    }

    this.weaponId = null;
    this.weapon = null;
    this.nameTag = null;
    this.lastHp = -1;
    this.updateTag(PLAYER_HP);

    // estado interpolado
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.wpPos = new THREE.Vector3();
    this.wpQuat = new THREE.Quaternion();
    this.lh = new THREE.Vector3();
    this.rh = new THREE.Vector3();
    this.target = null;
    this.draw = 0;
    this.swingT = 0;
    this.alive = true;
    this.first = true;
  }

  updateTag(hp) {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    if (this.nameTag) {
      this.group.remove(this.nameTag);
      this.nameTag.material.map.dispose();
      this.nameTag.material.dispose();
    }
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 80;
    const g = c.getContext('2d');
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(this.name, 128, 32);
    g.fillStyle = this.team == null ? '#fff' : teamColor(this.team);
    g.fillText(this.name, 128, 32);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(28, 50, 200, 14);
    g.fillStyle = hp > 50 ? '#66dd66' : hp > 25 ? '#ddcc44' : '#dd4444';
    g.fillRect(30, 52, 196 * (hp / PLAYER_HP), 10);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.nameTag.scale.set(0.8, 0.25, 1);
    this.group.add(this.nameTag);
  }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.color = team == null ? hueColor(this.id) : new THREE.Color(teamColor(team));
    this.cloth.color.copy(this.color);
    this.lastHp = -1; // redibuja la etiqueta con el color de la escuadra
    this.updateTag(this.lastHpValue ?? PLAYER_HP);
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.weapon) this.group.remove(this.weapon);
    this.weapon = id ? createWeaponModel(id) : null;
    if (this.weapon) this.group.add(this.weapon);
  }

  update(dt) {
    const t = this.target;
    if (!t) return;
    const k = this.first ? 1 : 1 - Math.exp(-dt * 16);
    this.first = false;
    this.pos.lerp(_b.set(t.h[0], t.h[1], t.h[2]), k);
    this.quat.slerp(new THREE.Quaternion(t.h[3], t.h[4], t.h[5], t.h[6]), k);
    this.wpPos.lerp(_b.set(t.wp[0], t.wp[1], t.wp[2]), k);
    this.wpQuat.slerp(new THREE.Quaternion(t.wp[3], t.wp[4], t.wp[5], t.wp[6]), k);
    this.lh.lerp(_b.set(t.lh[0], t.lh[1], t.lh[2]), k);
    this.rh.lerp(_b.set(t.rh[0], t.rh[1], t.rh[2]), k);
    this.draw = t.a;

    // cabeza
    this.head.position.copy(this.pos);
    this.head.quaternion.copy(this.quat);
    // torso y piernas siguen la orientación horizontal de la cabeza
    const yaw = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ').y;
    this.torso.position.set(this.pos.x, this.pos.y - 0.55, this.pos.z);
    this.torso.rotation.set(0, yaw, 0);
    const legTop = this.pos.y - 0.9;
    this.legs.scale.set(1, Math.max(0.2, legTop), 1);
    this.legs.position.set(this.pos.x, legTop / 2, this.pos.z);
    // manos y brazos
    this.handL.position.copy(this.lh);
    this.handR.position.copy(this.rh);
    const sh = new THREE.Vector3(0.22, -0.32, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    setLimb(this.armR, _b.copy(this.pos).add(sh), this.rh);
    sh.x = -0.22;
    sh.set(-0.22, -0.32, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    setLimb(this.armL, _b.copy(this.pos).add(sh), this.lh);
    this.nameTag.position.set(this.pos.x, this.pos.y + 0.42, this.pos.z);

    if (this.weapon) {
      this.weapon.position.copy(this.wpPos);
      this.weapon.quaternion.copy(this.wpQuat);
      const bow = this.weapon.userData.bow;
      if (bow) bow.setNock(BRACE + MAX_DRAW * this.draw);
      if (this.weapon.userData.cords) this.weapon.userData.cords.rotation.z = this.draw * 40 + performance.now() * 0.02 * this.draw;
    }
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map();
  }

  add(id, name, team = null) {
    if (this.avatars.has(id)) return this.avatars.get(id);
    const a = new Avatar(id, name, team);
    a.group.visible = false; // hasta recibir la primera pose
    this.scene.add(a.group);
    this.avatars.set(id, a);
    return a;
  }

  rename(id, name) {
    const a = this.avatars.get(id);
    if (a && a.name !== name) {
      a.name = name;
      a.lastHp = -1;
      a.updateTag(a.lastHpValue ?? PLAYER_HP);
    }
  }

  setTeam(id, team) {
    this.avatars.get(id)?.setTeam(team);
  }

  remove(id) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    this.avatars.delete(id);
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }

  applySnapshot(list, myId) {
    for (const [id, h, w, wp, a, lh, rh, hp, alive] of list) {
      if (id === myId) continue;
      const av = this.avatars.get(id);
      if (!av) continue;
      av.target = { h, wp, lh, rh, a };
      av.setWeapon(w);
      av.alive = !!alive;
      av.group.visible = !!alive;
      av.lastHpValue = hp;
      av.updateTag(hp);
    }
  }

  swing(id) {
    const a = this.avatars.get(id);
    if (a) a.swingT = 0.3;
  }

  update(dt) {
    for (const a of this.avatars.values()) if (a.group.visible) a.update(dt);
  }
}
