import * as THREE from 'three';

export const ARROWS_PER_END = 6;

export const RING_STYLE = {
  10: { bg: '#f6cf2e', fg: '#111' },
  9: { bg: '#f6cf2e', fg: '#111' },
  8: { bg: '#d83a30', fg: '#fff' },
  7: { bg: '#d83a30', fg: '#fff' },
  6: { bg: '#2a8fd6', fg: '#fff' },
  5: { bg: '#2a8fd6', fg: '#fff' },
  4: { bg: '#1b1b1b', fg: '#fff' },
  3: { bg: '#1b1b1b', fg: '#fff' },
  2: { bg: '#f5f5f5', fg: '#111' },
  1: { bg: '#f5f5f5', fg: '#111' },
  0: { bg: '#6b6b6b', fg: '#fff' },
};

const W = 1024;
const H = 640;

/** Estado de la puntuación + panel colgante (textura de canvas) que se ve en VR y en pantalla. */
export class Scoreboard {
  constructor() {
    this.shots = [];
    this.end = []; // tanda actual
    this.pastEnds = []; // totales de tandas completas
    this.last = null;
    this.windSpeed = 0;
    this.windAngle = 0;
    this._drawnWind = '';

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    this.object3d = this._buildGantry();
    this.draw();
  }

  _buildGantry() {
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 });
    const bw = 2.8;
    const bh = (bw * H) / W;
    const centerY = 3.05;

    const beam = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.18, 0.18), wood);
    beam.position.y = centerY + bh / 2 + 0.35;
    group.add(beam);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, beam.position.y + 0.1, 0.2), wood);
      post.position.set(sx * 4.5, post.geometry.parameters.height / 2, 0);
      group.add(post);
    }

    const board = new THREE.Group();
    board.position.y = centerY;
    board.rotation.x = 0.2; // inclinado hacia el arquero
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.12, bh + 0.12, 0.05), wood);
    board.add(frame);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })
    );
    face.position.z = 0.026;
    board.add(face);
    for (const sx of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      chain.position.set(sx * (bw / 2 - 0.2), bh / 2 + 0.2, 0);
      board.add(chain);
    }
    group.add(board);
    group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return group;
  }

  get stats() {
    const total = this.shots.reduce((s, x) => s + x.ring, 0);
    return {
      last: this.last,
      end: this.end,
      endScore: this.end.reduce((s, x) => s + x.ring, 0),
      total,
      count: this.shots.length,
      avg: this.shots.length ? total / this.shots.length : 0,
      pastEnds: this.pastEnds,
      endNumber: this.pastEnds.length + 1,
    };
  }

  addShot(shot) {
    if (this.end.length >= ARROWS_PER_END) {
      this.pastEnds.push(this.end.reduce((s, x) => s + x.ring, 0));
      this.end = [];
    }
    this.shots.push(shot);
    this.end.push(shot);
    this.last = shot;
    this.draw();
  }

  reset() {
    this.shots = [];
    this.end = [];
    this.pastEnds = [];
    this.last = null;
    this.draw();
  }

  setWind(speed, angle) {
    this.windSpeed = speed;
    this.windAngle = angle;
    const key = `${speed.toFixed(1)}|${angle.toFixed(1)}`;
    if (key !== this._drawnWind) this.draw();
  }

  draw() {
    const g = this.ctx;
    const s = this.stats;
    this._drawnWind = `${this.windSpeed.toFixed(1)}|${this.windAngle.toFixed(1)}`;

    g.fillStyle = '#12261a';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d9c9a0';
    g.lineWidth = 8;
    g.strokeRect(14, 14, W - 28, H - 28);

    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = '#f3e9c6';
    g.font = 'bold 56px sans-serif';
    g.fillText('CAMPO DE TIRO CON ARCO', 48, 98);

    g.font = '600 34px sans-serif';
    g.fillStyle = '#9fc9a2';
    g.fillText(`Tanda ${s.endNumber}`, 48, 160);

    // casillas de la tanda actual
    const size = 108;
    const gap = 16;
    for (let i = 0; i < ARROWS_PER_END; i++) {
      const x = 48 + i * (size + gap);
      const y = 184;
      const shot = s.end[i];
      g.fillStyle = shot ? RING_STYLE[shot.ring].bg : 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.roundRect(x, y, size, size, 18);
      g.fill();
      if (shot) {
        g.fillStyle = RING_STYLE[shot.ring].fg;
        g.font = 'bold 66px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(shot.label, x + size / 2, y + size / 2 + 4);
      }
    }

    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#f3e9c6';
    g.font = 'bold 46px sans-serif';
    g.fillText(`Tanda: ${s.endScore}`, 48, 360);
    g.fillText(`Total: ${s.total}`, 48, 420);
    g.font = '600 34px sans-serif';
    g.fillStyle = '#9fc9a2';
    g.fillText(`${s.count} flechas  ·  media ${s.avg.toFixed(1)}`, 48, 466);
    const past = s.pastEnds.slice(-4).map((v, i, arr) => `T${s.pastEnds.length - arr.length + i + 1}: ${v}`).join('   ');
    g.fillText(past || 'Dispara 6 flechas para completar una tanda', 48, 512);

    g.fillStyle = '#f3e9c6';
    g.font = 'bold 36px sans-serif';
    const last = s.last;
    let lastText = 'Última: —';
    if (last) {
      lastText = last.kind === 'ground' ? 'Última: al suelo' : `Última: ${last.label}  ·  diana a ${Math.round(last.distance)} m`;
    }
    g.fillText(lastText, 48, 580);

    // brújula de viento: la flecha apunta hacia donde sopla (arriba = hacia las dianas)
    const cx = 850;
    const cy = 440;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, 92, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#9fc9a2';
    g.font = '600 26px sans-serif';
    g.textAlign = 'center';
    g.fillText('↑ dianas', cx, cy - 104);
    g.save();
    g.translate(cx, cy);
    g.rotate(this.windAngle);
    const len = 18 + Math.min(1, this.windSpeed / 8) * 62;
    g.fillStyle = '#7ad1ff';
    g.beginPath();
    g.moveTo(0, -len);
    g.lineTo(26, -len + 36);
    g.lineTo(9, -len + 30);
    g.lineTo(9, len * 0.7);
    g.lineTo(-9, len * 0.7);
    g.lineTo(-9, -len + 30);
    g.lineTo(-26, -len + 36);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#f3e9c6';
    g.font = 'bold 40px sans-serif';
    g.fillText(`Viento ${this.windSpeed.toFixed(1)} m/s`, cx, cy + 150);

    this.texture.needsUpdate = true;
  }
}
