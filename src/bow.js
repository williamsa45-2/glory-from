import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { ARROW_LENGTH, BRACE } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);
const LIMB_HALF = 0.72; // mitad de la altura del arco
const BOW_X = 0.022; // el arco va a un lado de la flecha

function colored(geometry, hex) {
  const c = new THREE.Color(hex);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Cuerpo del arco modelado en Blender (si se ha cargado); si no, se usa el procedural. */
export const bowAssets = { body: null };

let arrowGeometry = null;
const arrowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });

/** Flecha con el origen en la punta y el cuerpo extendiéndose hacia +Z (la dirección de vuelo es -Z). */
export function createArrowMesh() {
  if (!arrowGeometry) {
    const L = ARROW_LENGTH;
    const parts = [];

    const shaftLen = L - 0.07;
    const shaft = new THREE.CylinderGeometry(0.0045, 0.0045, shaftLen, 6);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, 0.05 + shaftLen / 2);
    parts.push(colored(shaft, 0xcdb78c));

    const tip = new THREE.ConeGeometry(0.0075, 0.06, 8);
    tip.rotateX(-Math.PI / 2);
    tip.translate(0, 0, 0.03);
    parts.push(colored(tip, 0xb8bec6));

    const vaneColors = [0xd62828, 0xf1f1f1, 0xf1f1f1];
    for (let i = 0; i < 3; i++) {
      const vane = new THREE.BoxGeometry(0.0015, 0.028, 0.11);
      vane.translate(0, 0.018, 0);
      vane.rotateZ((i * Math.PI * 2) / 3);
      vane.translate(0, 0, L - 0.085);
      parts.push(colored(vane, vaneColors[i]));
    }

    const nock = new THREE.CylinderGeometry(0.0065, 0.0065, 0.02, 8);
    nock.rotateX(Math.PI / 2);
    nock.translate(0, 0, L - 0.01);
    parts.push(colored(nock, 0xd62828));

    arrowGeometry = mergeGeometries(parts);
  }
  const mesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
  mesh.frustumCulled = false; // el origen está en la punta: evitamos culling erróneo cerca de cámara
  return mesh;
}

function setSegment(mesh, a, b) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

function buildProceduralBody() {
  const parts = [];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const y = -LIMB_HALF + (i / 24) * LIMB_HALF * 2;
    pts.push(new THREE.Vector3(BOW_X, y, BRACE * Math.pow(Math.abs(y) / LIMB_HALF, 2.2)));
  }
  const limbs = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0115, 6, false);
  parts.push(colored(limbs, 0x23201d));

  const riser = new THREE.BoxGeometry(0.03, 0.32, 0.05);
  riser.translate(BOW_X + 0.012, 0, -0.012);
  parts.push(colored(riser, 0x7a4a24));
  const grip = new THREE.CylinderGeometry(0.019, 0.019, 0.11, 8);
  grip.translate(BOW_X + 0.012, 0, 0.0);
  parts.push(colored(grip, 0x2b1d14));
  for (const s of [-1, 1]) {
    const tip = new THREE.SphereGeometry(0.013, 8, 6);
    tip.translate(BOW_X, s * LIMB_HALF, BRACE);
    parts.push(colored(tip, 0xd9d2c0));
  }
  const body = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 })
  );
  return body;
}

/**
 * Arco recurvo. Apunta hacia -Z; la cuerda se estira hacia +Z (hacia el arquero).
 * `setNock(z)` mueve el punto de nock: BRACE = reposo, BRACE + MAX_DRAW = tensión completa.
 */
export class Bow {
  constructor() {
    this.group = new THREE.Group();
    this.nockZ = BRACE;
    this.vibT = 0;

    if (bowAssets.body) {
      this.group.add(bowAssets.body.clone(true));
    } else {
      this.group.add(buildProceduralBody());
    }

    const stringGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 4);
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xece6d2 });
    this.stringTop = new THREE.Mesh(stringGeo, stringMat);
    this.stringBottom = new THREE.Mesh(stringGeo, stringMat);
    this.group.add(this.stringTop, this.stringBottom);

    this.arrow = createArrowMesh();
    this.group.add(this.arrow);

    this.setNock(BRACE);
  }

  setNock(z) {
    this.vibT = 0;
    this._applyNock(z);
  }

  _applyNock(z) {
    this.nockZ = z;
    const top = new THREE.Vector3(BOW_X, LIMB_HALF, BRACE);
    const bottom = new THREE.Vector3(BOW_X, -LIMB_HALF, BRACE);
    const nock = new THREE.Vector3(0, 0, z);
    setSegment(this.stringTop, top, nock);
    setSegment(this.stringBottom, nock, bottom);
    this.arrow.position.set(0, 0, z - ARROW_LENGTH);
  }

  setArrowVisible(v) {
    this.arrow.visible = v;
  }

  /** Suelta la cuerda: vuelve al reposo vibrando. */
  release() {
    this._applyNock(BRACE);
    this.vibT = 0.4;
  }

  update(dt) {
    if (this.vibT > 0) {
      this.vibT = Math.max(0, this.vibT - dt);
      const k = this.vibT / 0.4;
      this._applyNock(BRACE + Math.sin(this.vibT * 140) * 0.04 * k * k);
    }
  }
}
