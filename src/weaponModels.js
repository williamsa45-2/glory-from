import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Bow, createArrowMesh, bowAssets } from './bow.js';

// Convención de todos los modelos: origen en la empuñadura, la "punta" del arma apunta a -Z y "arriba" es +Y.

const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9 });
const organicMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0 });
const stringMat = new THREE.MeshBasicMaterial({ color: 0xece6d2 });

const C = {
  steel: 0xcfd6de, darkSteel: 0x7b8590, wood: 0x7a4a24, darkWood: 0x4e3118, leather: 0x3b2a1e, gold: 0xb89b4a,
  stone: 0x8a8a86, red: 0xd62828,
};

function colored(geometry, hex) {
  const c = new THREE.Color(hex);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Une las piezas en una malla metálica y otra orgánica (madera/cuero) para minimizar draw calls. */
function assemble(parts) {
  const group = new THREE.Group();
  for (const [mat, flag] of [[metalMat, true], [organicMat, false]]) {
    const geos = parts
      .filter((p) => p.metal === flag)
      .map((p) => colored(p.geo.index ? p.geo.toNonIndexed() : p.geo, p.color));
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

const part = (geo, color, metal = false) => ({ geo, color, metal });

/** Forma plana en XY (x ancho, y largo) extruida y girada para que "largo" sea -Z y el grosor sea Y. */
function blade(points, thickness, bevel = 0.003) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel * 0.7, bevelSegments: 1,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function cyl(r, _unused, zFrom, zTo, seg = 8, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, Math.abs(zTo - zFrom), seg);
  g.rotateX(-Math.PI / 2); // eje Y -> -Z ; la base de radio r queda en +Z
  g.translate(0, 0, (zFrom + zTo) / 2);
  return g;
}

function box(w, h, d, x = 0, y = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function segment(mesh, a, b) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

// --------------------------------------------------------------------------- modelos
function buildSword() {
  const g = assemble([
    part(blade([[-0.026, 0.1], [0.026, 0.1], [0.023, 0.8], [0, 0.95], [-0.023, 0.8]], 0.01), C.steel, true),
    part(box(0.2, 0.024, 0.032, 0, 0, -0.1), C.gold, true),
    part(cyl(0.015, 0.22, 0.12, -0.1), C.leather),
    part(new THREE.SphereGeometry(0.024, 10, 8).translate(0, 0, 0.14), C.gold, true),
  ]);
  g.userData.tipZ = -0.95;
  return g;
}

function buildAxe() {
  const g = assemble([
    part(cyl(0.017, 0.85, 0.16, -0.7, 8), C.wood),
    part(blade([[-0.03, 0.46], [0.05, 0.5], [0.14, 0.4], [0.2, 0.59], [0.14, 0.78], [0.05, 0.7], [-0.03, 0.74]], 0.03, 0.004), C.steel, true),
    part(box(0.05, 0.05, 0.06, -0.045, 0, -0.6), C.darkSteel, true),
    part(cyl(0.02, 0.05, 0.14, 0.17, 8), C.leather),
  ]);
  g.userData.tipZ = -0.74;
  return g;
}

function buildSpear() {
  const g = assemble([
    part(cyl(0.013, 1.95, 0.5, -1.4, 8), C.wood),
    part(blade([[-0.032, 1.4], [-0.036, 1.5], [0, 1.68], [0.036, 1.5], [0.032, 1.4]], 0.01, 0.002), C.steel, true),
    part(cyl(0.02, 0.07, -1.34, -1.41, 8), C.darkSteel, true),
    part(cyl(0.017, 0.04, 0.5, 0.54, 8), C.darkSteel, true),
    part(cyl(0.015, 0.3, 0.15, -0.15, 8, 0.0155), C.leather),
  ]);
  g.userData.tipZ = -1.68;
  return g;
}

function proceduralCrossbowBody() {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const x = -0.34 + (i / 16) * 0.68;
    pts.push(new THREE.Vector3(x, 0.045, -0.3 + 0.075 * Math.pow(Math.abs(x) / 0.34, 2)));
  }
  const prod = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.011, 6, false);
  return assemble([
    part(box(0.045, 0.06, 0.66, 0, 0, -0.06), C.wood),
    part(box(0.03, 0.04, 0.2, 0, -0.05, 0.1).rotateX(0.35), C.darkWood),
    part(box(0.026, 0.016, 0.5, 0, 0.038, -0.14), C.darkWood),
    part(prod, C.darkWood),
    part(box(0.05, 0.02, 0.04, 0, 0.04, -0.3), C.darkSteel, true),
    part(new THREE.TorusGeometry(0.02, 0.003, 4, 10).translate(0, 0.075, -0.3), C.darkSteel, true),
  ]);
}

/** El cuerpo (madera, arcos, herrajes) viene de Blender; la cuerda y el virote se animan por código. */
function buildCrossbow() {
  const g = new THREE.Group();
  g.add(external.crossbow ? external.crossbow.clone(true) : proceduralCrossbowBody());
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 4), stringMat);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 1, 4), stringMat);
  g.add(top, bottom);
  const bolt = createBoltMesh();
  g.add(bolt);
  const tipL = new THREE.Vector3(-0.34, 0.045, -0.3 + 0.075);
  const tipR = new THREE.Vector3(0.34, 0.045, -0.3 + 0.075);
  g.userData.setLoaded = (loaded) => {
    const nockZ = loaded ? -0.02 : -0.225;
    const nock = new THREE.Vector3(0, 0.045, nockZ);
    segment(top, tipL, nock);
    segment(bottom, nock, tipR);
    bolt.visible = loaded;
    bolt.position.set(0, 0.058, nockZ - 0.4); // la punta queda por delante; la cola, en la cuerda
  };
  g.userData.setLoaded(true);
  g.userData.tipZ = -0.5;
  return g;
}

function buildSling() {
  const g = assemble([
    part(cyl(0.016, 0.14, 0.07, -0.07, 8), C.leather),
    part(new THREE.SphereGeometry(0.02, 8, 6).translate(0, 0, 0.075), C.darkWood),
  ]);
  const cords = new THREE.Group();
  cords.position.set(0, 0, -0.07);
  const cordGeo = new THREE.CylinderGeometry(0.0018, 0.0018, 1, 4);
  const cordMat = new THREE.MeshStandardMaterial({ color: C.leather, roughness: 0.9 });
  const L = 0.5;
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(cordGeo, cordMat);
    segment(c, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 0.012, -L, 0));
    cords.add(c);
  }
  const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: C.leather, roughness: 0.85 }));
  pouch.scale.set(1.2, 0.55, 0.9);
  pouch.position.set(0, -L, 0);
  cords.add(pouch);
  const stone = createStoneMesh();
  stone.position.set(0, -L + 0.02, 0);
  cords.add(stone);
  g.add(cords);
  g.userData.cords = cords;
  g.userData.setStoneVisible = (v) => (stone.visible = v);
  g.userData.tipZ = -0.1;
  return g;
}

const stoneGeo = new THREE.IcosahedronGeometry(0.03, 1);
const stoneMat = new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.95, flatShading: true });
export function createStoneMesh() {
  const m = new THREE.Mesh(stoneGeo, stoneMat);
  m.scale.set(1, 0.8, 0.9);
  m.castShadow = true;
  return m;
}

let boltGeometry = null;
export function createBoltMesh() {
  if (!boltGeometry) {
    const L = 0.4;
    const parts = [];
    const shaft = new THREE.CylinderGeometry(0.0055, 0.0055, L - 0.05, 6).rotateX(Math.PI / 2).translate(0, 0, 0.04 + (L - 0.05) / 2);
    parts.push(colored(shaft, 0x4a4036));
    const tip = new THREE.ConeGeometry(0.009, 0.05, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.025);
    parts.push(colored(tip, 0xb8bec6));
    for (let i = 0; i < 3; i++) {
      const v = new THREE.BoxGeometry(0.0015, 0.02, 0.07).translate(0, 0.012, 0).rotateZ((i * Math.PI * 2) / 3).translate(0, 0, L - 0.05);
      parts.push(colored(v, i === 0 ? C.red : 0x222222));
    }
    boltGeometry = mergeGeometries(parts);
  }
  const m = new THREE.Mesh(boltGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
  m.frustumCulled = false;
  return m;
}

const builders = { sword: buildSword, axe: buildAxe, spear: buildSpear, crossbow: buildCrossbow, sling: buildSling };
builders.crossbow.dynamic = true; // usa el GLB como cuerpo pero añade cuerda y virote animados
const TIP_Z = { sword: -0.955, axe: -0.78, spear: -1.7 };

// --------------------------------------------------------------------------- API
const external = {}; // modelos .glb cargados (los hace Blender); si faltan se usan los procedurales

/** Modelo de un arma (origen en la empuñadura, punta hacia -Z). */
export function createWeaponModel(id) {
  if (id === 'bow') {
    const bow = new Bow();
    bow.setArrowVisible(false);
    bow.group.userData.bow = bow;
    bow.group.userData.tipZ = 0;
    return bow.group;
  }
  if (external[id] && !builders[id].dynamic) {
    const g = new THREE.Group();
    g.add(external[id].clone(true));
    g.userData.tipZ = TIP_Z[id];
    return g;
  }
  return builders[id]();
}

/** Hijo con origen en el punto de impacto (la punta), para proyectiles e instancias clavadas. */
export function createProjectileMesh(type) {
  if (type === 'arrow') return createArrowMesh();
  if (type === 'bolt') return createBoltMesh();
  if (type === 'stone') return createStoneMesh();
  const model = createWeaponModel(type);
  const holder = new THREE.Group();
  model.position.z = -model.userData.tipZ; // la punta queda en el origen del contenedor
  if (type === 'axe') model.rotation.z = -Math.PI / 2; // el filo (hacia +X en el modelo) va hacia -Y: en el plano del giro, por delante
  holder.add(model);
  holder.userData.tipZ = model.userData.tipZ;
  return holder;
}

export function registerExternalModel(id, object3d) {
  external[id] = object3d;
  if (id === 'bow') bowAssets.body = object3d;
}

/** Carga los modelos .glb hechos en Blender (assets/models). Los que falten se sustituyen por los procedurales. */
export async function loadWeaponModels() {
  const loader = new GLTFLoader();
  const base = new URL('../assets/models/', import.meta.url);
  await Promise.all(
    ['sword', 'axe', 'spear', 'crossbow', 'bow'].map(async (id) => {
      try {
        const gltf = await loader.loadAsync(new URL(`${id}.glb`, base).href);
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = false;
          }
        });
        registerExternalModel(id, gltf.scene);
      } catch (err) {
        console.warn(`Modelo ${id}.glb no disponible, se usa el procedural`, err?.message ?? err);
      }
    })
  );
}

/** Orientación en reposo de un arma tirada (plana en el suelo) o en el armero (vertical). */
export function restQuaternion(type, upright) {
  const q = new THREE.Quaternion();
  if (upright) {
    if (type !== 'bow') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  } else if (type === 'bow') {
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  }
  return q;
}
