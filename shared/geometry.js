import * as THREE from 'three';

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Distancia² mínima entre los segmentos p1-q1 y p2-q2 (Ericson, Real-Time Collision Detection). */
export function segSegDist2(p1, q1, p2, q2, out) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s;
  let t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > EPS ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  if (out) {
    out.s = s;
    out.t = t;
  }
  return _c1.distanceToSquared(_c2);
}

const _hit = { s: 0, t: 0 };

/** Primer parámetro t∈[0,1] en que el segmento p0→p1 toca una cápsula (a-b, radio r), o null. */
export function segCapsule(p0, p1, a, b, r) {
  const d2 = segSegDist2(p0, p1, a, b, _hit);
  return d2 <= r * r ? _hit.s : null;
}

/** Primer parámetro t del segmento que entra en una esfera, o null. */
export function segSphere(p0, p1, c, r) {
  _d1.subVectors(p1, p0);
  _r.subVectors(p0, c);
  const A = _d1.dot(_d1);
  const B = 2 * _r.dot(_d1);
  const C = _r.dot(_r) - r * r;
  if (C <= 0) return 0;
  if (A < 1e-12) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

/** Segmento contra caja alineada con los ejes. Devuelve {t, axis, sign} o null. */
export function segAABB(p0, p1, min, max) {
  let tmin = 0;
  let tmax = 1;
  let axis = -1;
  let sign = 0;
  for (const k of ['x', 'y', 'z']) {
    const d = p1[k] - p0[k];
    if (Math.abs(d) < 1e-9) {
      if (p0[k] < min[k] || p0[k] > max[k]) return null;
      continue;
    }
    let ta = (min[k] - p0[k]) / d;
    let tb = (max[k] - p0[k]) / d;
    let s = -1;
    if (ta > tb) {
      [ta, tb] = [tb, ta];
      s = 1;
    }
    if (ta > tmin) {
      tmin = ta;
      axis = k;
      sign = s;
    }
    if (tb < tmax) tmax = tb;
    if (tmin > tmax) return null;
  }
  return { t: tmin, axis, sign };
}

const STEP_HEIGHT = 0.35; // altura que se sube sin saltar
const BODY_HEIGHT = 1.7;

/** Saca un punto (x,z) de las cajas que bloquean el paso, según la altura de los pies. Devuelve true si lo movió. */
export function pushOutOfBoxes(pos, radius, boxes, feetY = 0) {
  let moved = false;
  for (const b of boxes) {
    if (b.max.y <= feetY + STEP_HEIGHT) continue; // se puede pisar: no bloquea
    if (b.min.y >= feetY + BODY_HEIGHT) continue; // por encima de la cabeza
    const minX = b.min.x - radius;
    const maxX = b.max.x + radius;
    const minZ = b.min.z - radius;
    const maxZ = b.max.z + radius;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
    const dx = Math.min(pos.x - minX, maxX - pos.x);
    const dz = Math.min(pos.z - minZ, maxZ - pos.z);
    if (dx < dz) pos.x = pos.x - minX < maxX - pos.x ? minX : maxX;
    else pos.z = pos.z - minZ < maxZ - pos.z ? minZ : maxZ;
    moved = true;
  }
  return moved;
}

/** Altura del suelo bajo (x,z): el suelo (0) o la cara superior de la caja más alta que se puede pisar desde `feetY`. */
export function supportHeight(pos, boxes, feetY = 0, margin = 0.12) {
  let h = 0;
  for (const b of boxes) {
    if (b.max.y > feetY + STEP_HEIGHT || b.max.y <= h) continue;
    if (pos.x >= b.min.x - margin && pos.x <= b.max.x + margin && pos.z >= b.min.z - margin && pos.z <= b.max.z + margin) h = b.max.y;
  }
  return h;
}
