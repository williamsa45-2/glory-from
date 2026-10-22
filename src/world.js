import * as THREE from 'three';
import { LANES, TARGET_CENTER_Y, TARGET_TILT, BOSS_DEPTH, TRAINING_MAP } from '../shared/maps.js';
import { createEnvironment } from './environment.js';
import { grassTexture } from './textures.js';

export { DECK } from '../shared/maps.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function woodDeckTexture(repeat) {
  const rand = rng(3);
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      const rows = 16;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const l = 38 + rand() * 12;
        g.fillStyle = `hsl(${26 + rand() * 6}, ${38 + rand() * 12}%, ${l}%)`;
        g.fillRect(0, r * rh, w, rh);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `hsla(25, 40%, ${l - 12}%, 0.35)`;
          g.fillRect(rand() * w, r * rh + rand() * rh, 20 + rand() * 90, 1);
        }
        g.fillStyle = 'rgba(20,10,5,0.75)';
        g.fillRect(0, r * rh, w, 2);
        g.fillRect(rand() * w, r * rh, 2, rh);
      }
    },
    repeat
  );
}

function strawTexture() {
  const rand = rng(5);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#c9a24d';
    g.fillRect(0, 0, w, h);
    const tones = ['#e6c872', '#d9b45a', '#b88a35', '#f0d98c', '#a87a2c'];
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = tones[Math.floor(rand() * tones.length)];
      g.fillRect(rand() * w, rand() * h, 12 + rand() * 40, 1 + rand() * 2);
    }
  });
}

function targetFaceTexture() {
  const colors = { white: '#f5f5f5', black: '#1b1b1b', blue: '#2a8fd6', red: '#d83a30', gold: '#f6cf2e' };
  // anillo 1..10 desde fuera hacia dentro
  const ringColor = ['white', 'white', 'black', 'black', 'blue', 'blue', 'red', 'red', 'gold', 'gold'];
  return canvasTexture(512, 512, (g) => {
    const R = 256;
    for (let k = 0; k < 10; k++) {
      const r = (R * (10 - k)) / 10;
      g.beginPath();
      g.arc(R, R, r, 0, Math.PI * 2);
      g.fillStyle = colors[ringColor[k]];
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = ringColor[k] === 'black' ? '#d8d8d8' : '#1b1b1b';
      g.stroke();
    }
    g.beginPath();
    g.arc(R, R, R / 20, 0, Math.PI * 2);
    g.strokeStyle = '#8a6d00';
    g.stroke();
    g.beginPath();
    g.moveTo(R - 5, R);
    g.lineTo(R + 5, R);
    g.moveTo(R, R - 5);
    g.lineTo(R, R + 5);
    g.stroke();
  });
}

function labelTexture(text) {
  return canvasTexture(256, 96, (g, w, h) => {
    g.fillStyle = '#3a2a1a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9c9a0';
    g.lineWidth = 6;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#f3e9c6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 62;
    g.font = `bold ${size}px sans-serif`;
    while (g.measureText(text).width > w - 40 && size > 20) {
      size -= 2;
      g.font = `bold ${size}px sans-serif`;
    }
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

const UP = new THREE.Vector3(0, 1, 0);
/** Cilindro entre dos puntos. */
function limb(a, b, radius, material) {
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

export function createWorld(scene, renderer) {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9 });
  const rand = rng(42);

  // --- Cielo, luces y nubes (compartido con la arena) ---------------------
  const env = createEnvironment(scene, renderer);
  const sun = env.sun;

  // --- Suelo -----------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshLambertMaterial({ map: grassTexture([160, 160], { seed: 7 }) })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const FIELD_W = 26;
  const FIELD_Z0 = 8;
  const FIELD_Z1 = -92;
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_W, FIELD_Z0 - FIELD_Z1),
    new THREE.MeshLambertMaterial({ map: grassTexture([FIELD_W / 6, (FIELD_Z0 - FIELD_Z1) / 6], { seed: 11, lift: 0.04 }) })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0.01, (FIELD_Z0 + FIELD_Z1) / 2);
  field.receiveShadow = true;
  scene.add(field);

  // plataforma de tiro + línea
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(14.6, 5.4),
    new THREE.MeshStandardMaterial({ map: woodDeckTexture([14.6 / 4, 5.4 / 2]), roughness: 0.85 })
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0.02, 2.2);
  deck.receiveShadow = true;
  scene.add(deck);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 0.08), new THREE.MeshBasicMaterial({ color: 0xf4d03f }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.03, -0.45);
  scene.add(line);

  // banco y carcaj
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.4), woodMat);
  seat.position.y = 0.45;
  bench.add(seat);
  for (const lx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.34), woodMat);
    leg.position.set(lx, 0.22, 0);
    bench.add(leg);
  }
  bench.position.set(-5.2, 0.02, 3.6);
  bench.traverse((o) => (o.castShadow = o.receiveShadow = true));
  scene.add(bench);

  // --- Dianas ------------------------------------------------------------------
  const strawMat = new THREE.MeshStandardMaterial({ map: strawTexture(), roughness: 1 });
  const faceTex = targetFaceTexture();
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9 });
  const targets = [];
  const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), -TARGET_TILT);

  LANES.forEach((lane, index) => {
    const root = new THREE.Group();
    root.position.set(lane.x, 0, -lane.dist);

    const R = lane.diameter / 2;
    const bossR = R + 0.09;

    const pivot = new THREE.Group();
    pivot.position.y = TARGET_CENTER_Y;
    pivot.rotation.x = -TARGET_TILT;
    root.add(pivot);

    const boss = new THREE.Mesh(new THREE.CylinderGeometry(bossR, bossR, BOSS_DEPTH, 40), strawMat);
    boss.rotation.x = Math.PI / 2;
    boss.castShadow = boss.receiveShadow = true;
    pivot.add(boss);

    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 64), faceMat);
    face.position.z = BOSS_DEPTH / 2 + 0.0005;
    face.receiveShadow = true;
    pivot.add(face);

    const spread = 0.3 + 0.3 * bossR;
    const top = TARGET_CENTER_Y - 0.1;
    for (const s of [-1, 1]) {
      root.add(limb(new THREE.Vector3(s * (spread + 0.2), 0, 0.5), new THREE.Vector3(s * spread * 0.6, top, -0.14), 0.03, woodMat));
    }
    root.add(limb(new THREE.Vector3(0, 0, -0.95), new THREE.Vector3(0, top, -0.14), 0.03, woodMat));

    const bannerY = TARGET_CENTER_Y + bossR + 0.4;
    root.add(limb(new THREE.Vector3(0, TARGET_CENTER_Y, -0.2), new THREE.Vector3(0, bannerY + 0.2, -0.2), 0.025, darkWoodMat));
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.34),
      new THREE.MeshBasicMaterial({ map: labelTexture(`${lane.dist} m`) })
    );
    banner.position.set(0, bannerY, -0.17);
    root.add(banner);

    root.traverse((o) => {
      if (o.isMesh && o !== banner) o.castShadow = true;
    });
    scene.add(root);

    const center = new THREE.Vector3(lane.x, TARGET_CENTER_Y, -lane.dist).addScaledVector(normal, BOSS_DEPTH / 2);
    targets.push({ index, distance: lane.dist, faceRadius: R, bossRadius: bossR, center, normal: normal.clone(), group: root });
  });

  // --- Entorno -----------------------------------------------------------------
  // berma de tierra al fondo
  const berm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10), new THREE.MeshLambertMaterial({ color: 0x5b7f3d }));
  berm.scale.set(48, 5, 8);
  berm.position.set(0, -0.5, -96);
  scene.add(berm);

  // colinas lejanas
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x4d7048 });
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), hillMat);
    hill.scale.set(90 + rand() * 80, 24 + rand() * 30, 70 + rand() * 40);
    hill.position.set(-420 + i * 105 + rand() * 40, -6, -330 - rand() * 80);
    scene.add(hill);
  }

  // valla de cuerda
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6);
  postGeo.translate(0, 0.55, 0);
  const fenceZs = [];
  for (let z = FIELD_Z0 - 2; z >= FIELD_Z1 + 4; z -= 5) fenceZs.push(z);
  const posts = new THREE.InstancedMesh(postGeo, woodMat, fenceZs.length * 2);
  const m4 = new THREE.Matrix4();
  fenceZs.forEach((z, i) => {
    posts.setMatrixAt(i * 2, m4.makeTranslation(-FIELD_W / 2 + 0.5, 0, z));
    posts.setMatrixAt(i * 2 + 1, m4.makeTranslation(FIELD_W / 2 - 0.5, 0, z));
  });
  posts.castShadow = true;
  scene.add(posts);
  const ropeLen = FIELD_Z0 - 2 - (FIELD_Z1 + 4);
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xd8c9a3 });
  for (const sx of [-1, 1]) {
    for (const y of [0.55, 0.95]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, ropeLen), ropeMat);
      rope.position.set(sx * (FIELD_W / 2 - 0.5), y, FIELD_Z0 - 2 - ropeLen / 2);
      scene.add(rope);
    }
  }

  // bosque (todo instanciado: 4 draw calls)
  const treeCount = 150;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6).translate(0, 1.2, 0);
  const pine1Geo = new THREE.ConeGeometry(2.1, 3.8, 7).translate(0, 3.7, 0);
  const pine2Geo = new THREE.ConeGeometry(1.5, 3.2, 7).translate(0, 5.6, 0);
  const roundGeo = new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.2, 0);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, darkWoodMat, treeCount);
  const pines1 = new THREE.InstancedMesh(pine1Geo, leafMat, treeCount);
  const pines2 = new THREE.InstancedMesh(pine2Geo, leafMat, treeCount);
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, treeCount);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < treeCount; i++) {
    let x;
    let z;
    do {
      x = (rand() - 0.5) * 340;
      z = 60 - rand() * 300;
    } while (Math.abs(x) < 18 && z > -105);
    const scale = 0.8 + rand() * 1.1;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    if (rand() < 0.62) {
      pines1.setMatrixAt(i, dummy.matrix);
      pines2.setMatrixAt(i, dummy.matrix);
      rounds.setMatrixAt(i, hidden);
      col.setHSL(0.36 + rand() * 0.04, 0.45, 0.17 + rand() * 0.07);
      pines1.setColorAt(i, col);
      pines2.setColorAt(i, col);
      rounds.setColorAt(i, col);
    } else {
      rounds.setMatrixAt(i, dummy.matrix);
      pines1.setMatrixAt(i, hidden);
      pines2.setMatrixAt(i, hidden);
      col.setHSL(0.22 + rand() * 0.1, 0.5, 0.26 + rand() * 0.08);
      pines1.setColorAt(i, col);
      pines2.setColorAt(i, col);
      rounds.setColorAt(i, col);
    }
  }
  scene.add(trunks, pines1, pines2, rounds);

  // --- Banderas de viento ------------------------------------------------------
  const flags = [];
  function addFlag(x, z, height) {
    const pole = limb(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z), 0.045, new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
    pole.castShadow = true;
    scene.add(pole);
    const geo = new THREE.PlaneGeometry(1.5, 0.8, 14, 4);
    geo.translate(0.75, 0, 0);
    const base = geo.attributes.position.array.slice();
    const flagMesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: 0xe5532d, side: THREE.DoubleSide })
    );
    const pivot = new THREE.Group();
    pivot.position.set(x, height - 0.45, z);
    pivot.add(flagMesh);
    scene.add(pivot);
    flags.push({ pivot, geo, base });
  }
  addFlag(-9, -7, 4.5);
  addFlag(9, -38, 7);

  function updateFlags(t, wind) {
    const amp = Math.min(1, wind.speed / 7);
    const heading = wind.speed > 0.05 ? Math.atan2(-wind.vec.z, wind.vec.x) : 0;
    for (const f of flags) {
      f.pivot.rotation.y = heading;
      const pos = f.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const bx = f.base[i * 3];
        const by = f.base[i * 3 + 1];
        const u = bx / 1.5;
        pos.setXYZ(
          i,
          bx * (1 - (1 - amp) * 0.25 * u),
          by - (1 - amp) * u * u * 0.9,
          Math.sin(t * 7 - u * 7) * 0.13 * u * (0.25 + 0.75 * amp)
        );
      }
      pos.needsUpdate = true;
      f.geo.computeVertexNormals();
    }
  }

  // --- Muñecos de paja para probar las armas cuerpo a cuerpo ------------------------
  const dummyMeshes = TRAINING_MAP.dummies.map((d, i) => {
    const root = new THREE.Group();
    const strawBody = new THREE.MeshStandardMaterial({ map: strawTexture(), roughness: 1 });
    const sack = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 });
    const parts = [];
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), woodMat);
    post.position.y = 0.85;
    const arms = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.09, 0.09), woodMat);
    arms.position.y = 1.28;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.78, 14), strawBody);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), sack);
    head.position.y = 1.62;
    const feet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.14), woodMat);
    feet.position.y = 0.04;
    const feet2 = feet.clone();
    feet2.rotation.y = Math.PI / 2;
    for (const m of [post, arms, torso, head, feet, feet2]) {
      m.castShadow = m.receiveShadow = true;
      root.add(m);
      parts.push(m);
    }
    root.position.set(d.x, 0, d.z);
    scene.add(root);
    return { id: `d${i}`, root, flash: 0, mats: [strawBody, sack] };
  });

  // --- Armero (a la derecha de la plataforma, mirando al centro) ---------------------------------
  {
    const [rx, , rz] = TRAINING_MAP.rack.pos;
    const w = TRAINING_MAP.rack.width;
    const rack = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.9, w + 0.3), new THREE.MeshStandardMaterial({ color: 0x8c6a45, roughness: 0.9 }));
    board.position.set(rx + 0.3, 1.3, rz);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.4),
      new THREE.MeshBasicMaterial({ map: labelTexture('ARMERO') })
    );
    sign.position.set(rx + 0.26, 2.5, rz);
    sign.rotation.y = -Math.PI / 2;
    rack.add(board, sign);
    for (const sz of [-1, 1]) {
      rack.add(limb(new THREE.Vector3(rx + 0.3, 0, rz + sz * (w / 2 + 0.15)), new THREE.Vector3(rx + 0.3, 2.5, rz + sz * (w / 2 + 0.15)), 0.07, woodMat));
    }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, w + 0.3), woodMat);
    shelf.position.set(rx + 0.1, 0.55, rz);
    rack.add(shelf);
    for (const it of TRAINING_MAP.items) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.28, 6), woodMat);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(it.pos[0] + 0.17, 0.95, it.pos[2]);
      rack.add(peg);
    }
    rack.traverse((o) => (o.castShadow = o.receiveShadow = true));
    scene.add(rack);
  }

  return {
    dummies: dummyMeshes,
    flashDummy(id) {
      const d = dummyMeshes.find((m) => m.id === id);
      if (d) d.flash = 0.18;
    },
    targets,
    sun,
    deckCenter: new THREE.Vector3(0, 0, 2.2),
    update(t, dt, wind, camera) {
      env.update(camera, dt, wind.speed);
      updateFlags(t, wind);
      for (const d of dummyMeshes) {
        d.flash = Math.max(0, d.flash - dt);
        for (const m of d.mats) {
          m.emissive.setRGB(d.flash * 3, d.flash * 0.6, d.flash * 0.4);
        }
      }
    },
  };
}
