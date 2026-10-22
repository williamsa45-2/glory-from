import * as THREE from 'three';

function textSprite(text, { color = '#fff', font = 'bold 64px sans-serif', bg = null, w = 256, h = 128 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#111';
    g.stroke();
  }
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  if (!bg) g.strokeText(text, w / 2, h / 2);
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.renderOrder = 10;
  return sprite;
}

/** Textos flotantes (daño, puntuación) y pequeñas ráfagas de partículas en los impactos. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.floaters = [];
    this.bursts = [];
  }

  float(position, text, { color = '#fff', size = 0.5, rise = 0.6, life = 1.4, ring = null } = {}) {
    const sprite = ring
      ? textSprite(text, { color: ring.fg, bg: ring.bg, font: 'bold 76px sans-serif', w: 128, h: 128 })
      : textSprite(text, { color });
    sprite.position.copy(position);
    sprite.scale.set(size * (ring ? 1 : 2), size, 1);
    this.scene.add(sprite);
    this.floaters.push({ sprite, age: 0, life, rise });
  }

  burst(position, color = 0xffe0a0, count = 10, speed = 3) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos.set([position.x, position.y, position.z], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.06, transparent: true, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }

  update(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.sprite.position.y += dt * f.rise;
      f.sprite.material.opacity = Math.min(1, (f.life - f.age) * 2);
      if (f.age > f.life) {
        this.scene.remove(f.sprite);
        f.sprite.material.map.dispose();
        f.sprite.material.dispose();
        this.floaters.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const pos = b.points.geometry.attributes.position;
      for (let k = 0; k < b.vel.length; k++) {
        b.vel[k].y -= 9 * dt;
        pos.setXYZ(k, pos.getX(k) + b.vel[k].x * dt, pos.getY(k) + b.vel[k].y * dt, pos.getZ(k) + b.vel[k].z * dt);
      }
      pos.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - b.age / 0.5);
      if (b.age > 0.5) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}

export { textSprite };
