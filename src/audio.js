import * as THREE from 'three';

const TAU = Math.PI * 2;
const SPEED_OF_SOUND = 343;

function makeBuffer(ctx, seconds, fn) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fadeIn = Math.min(1, t / 0.002);
    data[i] = fn(t) * fadeIn;
  }
  return buf;
}

const noise = () => Math.random() * 2 - 1;

/** Todos los sonidos se sintetizan al arrancar: no hay archivos de audio. */
export class GameAudio {
  constructor(camera, scene) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    const ctx = this.listener.context;

    let lp = 0;
    this.buffers = {
      twang: makeBuffer(ctx, 0.7, (t) => {
        lp += (noise() - lp) * 0.3;
        const tone =
          0.5 * Math.sin(TAU * 150 * t) + 0.25 * Math.sin(TAU * 301 * t + 1) + 0.12 * Math.sin(TAU * 452 * t);
        return (Math.exp(-t * 8) * tone + Math.exp(-t * 60) * lp * 0.8) * 0.7;
      }),
      nock: makeBuffer(ctx, 0.09, (t) => Math.exp(-t * 200) * noise() * 0.5 + Math.exp(-t * 80) * Math.sin(TAU * 900 * t) * 0.2),
      whoosh: makeBuffer(ctx, 0.8, (t) => {
        lp += (noise() - lp) * 0.12;
        return lp * Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.8)), 2) * 0.55;
      }),
      thudTarget: makeBuffer(ctx, 0.4, (t) => {
        lp += (noise() - lp) * 0.08;
        const phase = TAU * (55 * t + (70 / 25) * (1 - Math.exp(-25 * t)));
        return Math.exp(-t * 16) * 0.9 * Math.sin(phase) + Math.exp(-t * 35) * lp * 0.9;
      }),
      thudGround: makeBuffer(ctx, 0.3, (t) => {
        lp += (noise() - lp) * 0.05;
        return Math.exp(-t * 22) * 0.7 * Math.sin(TAU * 45 * t) + Math.exp(-t * 40) * lp * 0.6;
      }),
      crossbow: makeBuffer(ctx, 0.35, (t) => {
        lp += (noise() - lp) * 0.4;
        return (Math.exp(-t * 30) * lp * 0.9 + Math.exp(-t * 14) * Math.sin(TAU * 110 * t) * 0.8) * 0.8;
      }),
      sling: makeBuffer(ctx, 0.25, (t) => {
        lp += (noise() - lp) * (0.1 + t * 2);
        return lp * Math.exp(-t * 12) * 1.2 + Math.exp(-t * 90) * noise() * 0.3;
      }),
      swing: makeBuffer(ctx, 0.35, (t) => {
        lp += (noise() - lp) * 0.08;
        return lp * Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.35)), 1.5) * 0.9;
      }),
      flesh: makeBuffer(ctx, 0.3, (t) => {
        lp += (noise() - lp) * 0.12;
        return Math.exp(-t * 18) * Math.sin(TAU * 90 * t) * 0.9 + Math.exp(-t * 40) * lp * 0.8;
      }),
      clang: makeBuffer(ctx, 0.5, (t) =>
        (Math.sin(TAU * 1180 * t) * 0.4 + Math.sin(TAU * 1870 * t) * 0.3 + Math.sin(TAU * 2790 * t) * 0.2) * Math.exp(-t * 14) * 0.7 + Math.exp(-t * 200) * noise() * 0.5
      ),
      pickup: makeBuffer(ctx, 0.18, (t) => Math.sin(TAU * (500 + 900 * t) * t) * Math.exp(-t * 18) * 0.5),
      hurt: makeBuffer(ctx, 0.3, (t) => Math.exp(-t * 14) * Math.sin(TAU * 70 * t) * 1.0 + Math.exp(-t * 60) * noise() * 0.4),
      ding: makeBuffer(ctx, 0.9, (t) =>
        (Math.sin(TAU * 1568 * t) * Math.exp(-t * 6) * 0.22 + Math.sin(TAU * 2352 * t) * Math.exp(-t * 9) * 0.1)
      ),
    };

    this.globalPool = [];
    for (let i = 0; i < 8; i++) this.globalPool.push(new THREE.Audio(this.listener));

    this.hitPool = [];
    for (let i = 0; i < 8; i++) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(15);
      a.setRolloffFactor(1.1);
      scene.add(a);
      this.hitPool.push(a);
    }

    this.whooshPool = [];
    for (let i = 0; i < 6; i++) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(4);
      a.setRolloffFactor(1.3);
      this.whooshPool.push(a);
    }
  }

  resume() {
    const ctx = this.listener.context;
    if (ctx.state !== 'running') ctx.resume();
  }

  _free(pool) {
    return pool.find((a) => !a.isPlaying) ?? null;
  }

  _play(name, volume = 1, playbackRate = 1) {
    const a = this._free(this.globalPool);
    if (!a) return;
    a.setBuffer(this.buffers[name]);
    a.setVolume(volume);
    a.setPlaybackRate(playbackRate);
    a.play();
  }

  nock() {
    this._play('nock', 0.7);
  }

  /** Sonido no posicional (UI, golpes propios). */
  playGlobal(name, volume = 1, rate = 1) {
    this._play(name, volume, rate);
  }

  /** Sonido en un punto del mundo con el retardo real de propagación. */
  playAt(name, position, volume = 2) {
    const a = this._free(this.hitPool);
    if (!a) return;
    const listenerPos = new THREE.Vector3();
    this.listener.getWorldPosition(listenerPos);
    a.position.copy(position);
    a.setBuffer(this.buffers[name]);
    a.setVolume(volume);
    a.play(Math.min(0.5, listenerPos.distanceTo(position) / SPEED_OF_SOUND));
  }

  twang(power = 1) {
    this._play('twang', 0.5 + 0.5 * power, 0.9 + 0.2 * power);
  }

  ding() {
    setTimeout(() => this._play('ding', 0.8), 120);
  }

  /** Impacto posicional; el sonido tarda lo que tardaría en llegar desde la diana. */
  hit(position, kind) {
    const a = this._free(this.hitPool);
    if (!a) return;
    const listenerPos = new THREE.Vector3();
    this.listener.getWorldPosition(listenerPos);
    a.position.copy(position);
    a.setBuffer(this.buffers[kind === 'target' ? 'thudTarget' : 'thudGround']);
    a.setVolume(kind === 'target' ? 3 : 2);
    a.play(Math.min(0.45, listenerPos.distanceTo(position) / SPEED_OF_SOUND));
  }

  /** Silbido que acompaña a la flecha mientras vuela. */
  startWhoosh(arrowMesh) {
    const a = this._free(this.whooshPool);
    if (!a) return null;
    arrowMesh.add(a);
    a.position.set(0, 0, 0.4);
    a.setBuffer(this.buffers.whoosh);
    a.setVolume(1.2);
    a.play();
    return a;
  }

  stopWhoosh(a) {
    if (!a) return;
    if (a.isPlaying) a.stop();
    a.removeFromParent();
  }
}
