import * as THREE from 'three';

const SKY_HORIZON = 0xcfe3f2;
const SKY_ZENITH = 0x4c86c8;
const GROUND_BOUNCE = 0x4a6a3a;
export const SUN_DIRECTION = new THREE.Vector3(-28, 42, 34).normalize();

const vertexShader = `varying vec3 vDir;
  void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 ground; uniform vec3 sunDir;
  uniform float lowerGround; uniform float sunStrength; varying vec3 vDir;
  void main(){
    float h = vDir.y;
    vec3 col = h >= 0.0 ? mix(horizon, zenith, pow(h, 0.5)) : mix(horizon, ground, clamp(-h * 4.0, 0.0, 1.0) * lowerGround);
    float s = max(dot(normalize(vDir), sunDir), 0.0);
    col += vec3(1.0, 0.9, 0.72) * (pow(s, 900.0) * 60.0 + pow(s, 10.0) * 0.18) * sunStrength;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function skyMaterial({ lowerGround, sunStrength }) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      ground: { value: new THREE.Color(GROUND_BOUNCE) },
      sunDir: { value: SUN_DIRECTION.clone() },
      lowerGround: { value: lowerGround },
      sunStrength: { value: sunStrength },
    },
    vertexShader,
    fragmentShader,
  });
}

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cielo, niebla, sol con sombras, nubes e iluminación por imagen (IBL).
 * El IBL se genera una vez a partir del propio cielo: da reflejos reales al metal (espadas, hachas, puntas).
 */
export function createEnvironment(scene, renderer, { fogDensity = 0.0036, shadowExtent = 60, sunTarget = new THREE.Vector3(0, 0, -30) } = {}) {
  scene.fog = new THREE.FogExp2(SKY_HORIZON, fogDensity);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMaterial({ lowerGround: 0, sunStrength: 1 }));
  sky.renderOrder = -10;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial({ lowerGround: 1, sunStrength: 1 })));
  const envMap = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envMap.texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xcfe6ff, GROUND_BOUNCE, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(60).add(sunTarget);
  sun.target.position.copy(sunTarget);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const rand = rng(42);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.93, fog: false });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    const puffs = 4 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      m.position.set((p - puffs / 2) * 22 + rand() * 8, rand() * 6, rand() * 10);
      m.scale.set(22 + rand() * 14, 7 + rand() * 4, 14 + rand() * 6);
      c.add(m);
    }
    const ang = rand() * Math.PI * 2;
    const rad = 220 + rand() * 200;
    c.position.set(Math.cos(ang) * rad, 110 + rand() * 60, Math.sin(ang) * rad);
    scene.add(c);
    clouds.push(c);
  }

  const camPos = new THREE.Vector3();
  return {
    sky,
    sun,
    hemi,
    update(camera, dt, windSpeed = 0) {
      camera.getWorldPosition(camPos);
      sky.position.copy(camPos);
      for (const c of clouds) {
        c.position.x += dt * (1 + windSpeed * 0.4);
        if (c.position.x > 480) c.position.x = -480;
      }
    },
  };
}
