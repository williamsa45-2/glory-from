import * as THREE from 'three';
import { PROJECTILES } from './weapons.js';

export const GRAVITY = 9.81;
export const FIXED_DT = 1 / 60;

const rel = new THREE.Vector3();

/** Un paso de vuelo de un proyectil (Euler semi-implícito). `wind` = velocidad del aire en m/s. */
export function stepProjectile(type, pos, vel, dt, wind) {
  const drag = PROJECTILES[type].drag;
  rel.copy(vel).sub(wind);
  vel.addScaledVector(rel, -drag * rel.length() * dt);
  vel.y -= GRAVITY * dt;
  pos.addScaledVector(vel, dt);
}

const NO_WIND = new THREE.Vector3();

function heightAtDistance(type, distance, elevation, speed) {
  const p = new THREE.Vector3();
  const v = new THREE.Vector3(Math.cos(elevation) * speed, Math.sin(elevation) * speed, 0);
  for (let i = 0; i < 1200; i++) {
    const prevX = p.x;
    const prevY = p.y;
    stepProjectile(type, p, v, FIXED_DT, NO_WIND);
    if (p.x >= distance) return prevY + (p.y - prevY) * ((distance - prevX) / (p.x - prevX));
  }
  return -Infinity;
}

/** Ángulo de elevación (rad) para llegar a `distance` m con una diferencia de altura `dy`. */
export function solveElevation(type, distance, dy, speed) {
  let lo = -0.2;
  let hi = 0.7;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (heightAtDistance(type, distance, mid, speed) < dy) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Puntuación World Archery (10 anillos) según la distancia r al centro de la diana. */
export function scoreHit(r, faceRadius) {
  const reach = Math.max(0, r - 0.0045);
  if (reach > faceRadius) return { ring: 0, label: 'M', x: false };
  const ring = Math.max(1, 10 - Math.floor(reach / (faceRadius / 10)));
  const x = reach <= faceRadius / 20;
  return { ring, label: x ? 'X' : String(ring), x };
}
