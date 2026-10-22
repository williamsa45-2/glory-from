import * as THREE from 'three';
import { WEAPONS, SLOTS, SLOT_LABEL, weaponInSlot, PLAYER_HP, isThrowing } from '../shared/weapons.js';

/** Dibuja el icono vectorial de un arma centrado en (cx, cy) dentro de un cuadrado de lado `size`. */
export function drawWeaponIcon(g, id, cx, cy, size, color = '#f3e9c6') {
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(size, size);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 0.06;
  g.beginPath();
  switch (id) {
    case 'sword':
      g.moveTo(0.18, 0.86); g.lineTo(0.78, 0.18); g.stroke();
      g.beginPath(); g.lineWidth = 0.07; g.moveTo(0.78, 0.18); g.lineTo(0.86, 0.1); g.stroke();
      g.beginPath(); g.lineWidth = 0.07; g.moveTo(0.28, 0.58); g.lineTo(0.48, 0.74); g.stroke();
      g.beginPath(); g.arc(0.14, 0.9, 0.045, 0, Math.PI * 2); g.fill();
      break;
    case 'axe':
      g.moveTo(0.2, 0.9); g.lineTo(0.7, 0.12); g.stroke();
      g.beginPath();
      g.moveTo(0.52, 0.22); g.quadraticCurveTo(0.95, 0.12, 0.85, 0.52); g.quadraticCurveTo(0.68, 0.4, 0.6, 0.42);
      g.closePath(); g.fill();
      break;
    case 'spear':
      g.moveTo(0.12, 0.9); g.lineTo(0.72, 0.28); g.stroke();
      g.beginPath();
      g.moveTo(0.64, 0.18); g.lineTo(0.9, 0.06); g.lineTo(0.82, 0.34); g.lineTo(0.72, 0.28); g.closePath(); g.fill();
      break;
    case 'bow':
      g.lineWidth = 0.07;
      g.arc(0.78, 0.5, 0.52, Math.PI * 0.72, Math.PI * 1.28); g.stroke();
      g.beginPath(); g.lineWidth = 0.03; g.moveTo(0.58, 0.16); g.lineTo(0.58, 0.84); g.stroke();
      g.beginPath(); g.lineWidth = 0.05; g.moveTo(0.58, 0.5); g.lineTo(0.12, 0.5); g.stroke();
      g.beginPath(); g.moveTo(0.12, 0.5); g.lineTo(0.2, 0.43); g.lineTo(0.2, 0.57); g.closePath(); g.fill();
      break;
    case 'crossbow':
      g.moveTo(0.1, 0.5); g.lineTo(0.9, 0.5); g.stroke();
      g.beginPath(); g.lineWidth = 0.07; g.moveTo(0.28, 0.14); g.quadraticCurveTo(0.45, 0.5, 0.28, 0.86); g.stroke();
      g.beginPath(); g.lineWidth = 0.03; g.moveTo(0.28, 0.14); g.lineTo(0.6, 0.5); g.lineTo(0.28, 0.86); g.stroke();
      g.beginPath(); g.moveTo(0.9, 0.5); g.lineTo(0.8, 0.43); g.lineTo(0.8, 0.57); g.closePath(); g.fill();
      break;
    case 'sling':
      g.lineWidth = 0.05;
      g.moveTo(0.5, 0.1); g.lineTo(0.5, 0.35); g.stroke();
      g.beginPath(); g.moveTo(0.5, 0.35); g.lineTo(0.28, 0.68); g.moveTo(0.5, 0.35); g.lineTo(0.72, 0.68); g.stroke();
      g.beginPath(); g.ellipse(0.5, 0.76, 0.17, 0.1, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0.5, 0.74, 0.06, 0, Math.PI * 2); g.fill();
      break;
    default:
      break;
  }
  g.restore();
}

export const SLOT_KEYS = { melee: '1', spear: '2', ranged: '3' };

/**
 * Dibuja los 3 huecos del inventario (cuerpo a cuerpo / lanza / distancia) con la munición y el modo de uso.
 * @returns ancho total dibujado
 */
export function drawInventory(g, inv, { x, y, slot = 78, gap = 10, infinite = false, keys = true, modeKey = 'F', hintSize = 13 } = {}) {
  let cx = x;
  for (const s of SLOTS) {
    const id = weaponInSlot(inv, s);
    const selected = inv.selected === s;
    g.fillStyle = selected ? 'rgba(255,214,102,0.22)' : 'rgba(10,20,14,0.62)';
    g.beginPath();
    g.roundRect(cx, y, slot, slot, 12);
    g.fill();
    g.lineWidth = selected ? 3 : 1.5;
    g.strokeStyle = selected ? '#ffd666' : id ? 'rgba(243,233,198,0.45)' : 'rgba(243,233,198,0.18)';
    if (!id) g.setLineDash([5, 5]);
    g.stroke();
    g.setLineDash([]);

    if (id) {
      drawWeaponIcon(g, id, cx + slot / 2, y + slot / 2 - 6, slot * 0.62, selected ? '#fff4cc' : '#cdd6c8');
      g.font = '600 11px sans-serif';
      g.textAlign = 'center';
      g.fillStyle = selected ? '#ffd666' : '#b8c2b4';
      g.fillText(WEAPONS[id].label, cx + slot / 2, y + slot - 6);
      const w = WEAPONS[id];
      if (w.slot === 'ranged') {
        g.font = 'bold 13px sans-serif';
        g.textAlign = 'right';
        g.fillStyle = !infinite && inv.ammo === 0 ? '#ff6b5e' : '#fff';
        g.fillText(infinite ? '∞' : `×${inv.ammo}`, cx + slot - 6, y + 17);
      } else if (w.throwable) {
        const throwing = isThrowing(inv, id);
        g.font = 'bold 10px sans-serif';
        g.textAlign = 'right';
        g.fillStyle = throwing ? '#ff8a65' : '#9fd0ff';
        g.fillText(throwing ? 'LANZAR' : 'MELÉ', cx + slot - 6, y + 15);
      }
    } else {
      g.font = '600 10px sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(243,233,198,0.4)';
      g.fillText(SLOT_LABEL[s], cx + slot / 2, y + slot / 2 + 3);
    }
    if (keys) {
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'left';
      g.fillStyle = selected ? '#ffd666' : 'rgba(243,233,198,0.6)';
      g.fillText(SLOT_KEYS[s], cx + 7, y + 17);
    }
    cx += slot + gap;
  }
  g.textAlign = 'left';
  drawModeHint(g, inv, { x, y: y + slot + hintSize + 6, modeKey, size: hintSize, width: cx - x - gap });
  return cx - x - gap;
}

/** Pista bajo el inventario: cómo lanzar el hacha o la lanza (se ve siempre que una esté seleccionada). */
function drawModeHint(g, inv, { x, y, modeKey, size, width }) {
  const id = weaponInSlot(inv, inv.selected);
  if (!id || !WEAPONS[id].throwable) return;
  const throwing = isThrowing(inv, id);
  const name = WEAPONS[id].label.toLowerCase();
  const text = WEAPONS[id].hitAndThrow
    ? `${WEAPONS[id].label.toUpperCase()} · clic: golpear · mantén y suelta: lanzar`
    : throwing
    ? `MODO LANZAR · [${modeKey}] volver a cuerpo a cuerpo`
    : `[${modeKey}] cambiar a LANZAR ${name}`;
  g.font = `700 ${size}px sans-serif`;
  const w = Math.min(width, g.measureText(text).width + 16);
  g.fillStyle = throwing ? 'rgba(160,60,20,0.85)' : 'rgba(0,0,0,0.6)';
  g.beginPath();
  g.roundRect(x, y - size - 3, Math.max(w, width), size + 10, 6);
  g.fill();
  g.fillStyle = throwing ? '#ffd9c2' : '#ffe08a';
  g.textAlign = 'left';
  g.fillText(text, x + 8, y + 2);
}

export function drawHealthBar(g, hp, { x, y, w = 240, h = 16 }) {
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect(x - 3, y - 3, w + 6, h + 6, 8);
  g.fill();
  const f = Math.max(0, hp) / PLAYER_HP;
  g.fillStyle = f > 0.5 ? '#6bd66b' : f > 0.25 ? '#e0c040' : '#e04a3c';
  g.beginPath();
  g.roundRect(x, y, w * f, h, 6);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 12px sans-serif';
  g.textAlign = 'left';
  g.fillText(`${Math.max(0, Math.round(hp))}`, x + 6, y + 12.5);
}

/** Panel que se lleva en la muñeca/mando en VR: siempre visible con solo bajar la vista. */
export class WristPanel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const w = 0.2;
    this.object3d = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 2),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false })
    );
    this.object3d.renderOrder = 5;
    this.key = '';
  }

  update(session, { showScore = false } = {}) {
    const inv = session.inv;
    const key = JSON.stringify([inv, session.hp, session.infinite, session.mode, session.alive, showScore && session.scoreList.length]);
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(8,16,12,0.78)';
    g.beginPath();
    g.roundRect(4, 4, 504, 248, 22);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,214,102,0.6)';
    g.stroke();
    drawInventory(g, inv, { x: 20, y: 20, slot: 132, gap: 14, infinite: session.infinite, keys: false, modeKey: 'B/Y', hintSize: 20 });
    if (session.mode === 'pvp') {
      drawHealthBar(g, session.hp, { x: 20, y: 212, w: 300, h: 26 });
      const me = session.players.get(session.myId);
      g.fillStyle = '#f3e9c6';
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'right';
      g.fillText(`☠ ${me?.k ?? 0} / ${session.killLimit}`, 494, 232);
    } else {
      g.fillStyle = '#9fc9a2';
      g.font = '600 22px sans-serif';
      g.fillText('Entrenamiento · munición infinita', 20, 236);
    }
    this.texture.needsUpdate = true;
  }
}
