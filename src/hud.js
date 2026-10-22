import { RING_STYLE } from './scoreboard.js';
import { drawInventory, drawHealthBar } from './inventoryUi.js';
import { teamName, teamColor } from '../shared/teams.js';

/** HUD 2D superpuesto (solo modo escritorio). */
export class DesktopHud {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.toastText = '';
    this.toastT = 0;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  toast(text, seconds = 1.8) {
    this.toastText = text;
    this.toastT = seconds;
  }

  clear() {
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * state: { dt, draw, fov, ladder, stats, wind, inv, infinite, mode, session, showScores, hint, melee }
   */
  draw(state) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const pvp = state.mode === 'pvp';
    const s = state.session;

    // viñeta roja al recibir daño
    if (pvp && s.hurt > 0) {
      const grad = g.createRadialGradient(cx, cy, this.h * 0.25, cx, cy, this.h * 0.85);
      grad.addColorStop(0, 'rgba(180,0,0,0)');
      grad.addColorStop(1, `rgba(200,0,0,${Math.min(0.6, s.hurt)})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, this.w, this.h);
    }

    // mira
    g.lineWidth = 2;
    g.strokeStyle = state.draw > 0.01 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 3;
    g.beginPath();
    if (state.melee && !state.throwMode) {
      g.arc(cx, cy, 3, 0, Math.PI * 2);
    } else {
      g.arc(cx, cy, 14, 0, Math.PI * 2);
      g.moveTo(cx - 24, cy);
      g.lineTo(cx - 8, cy);
      g.moveTo(cx + 8, cy);
      g.lineTo(cx + 24, cy);
      g.moveTo(cx, cy - 24);
      g.lineTo(cx, cy - 8);
    }
    g.stroke();
    if (state.throwMode) {
      g.font = '800 15px sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#ff9e6b';
      g.fillText('LANZAR · mantén clic y suelta', cx, cy + 48);
      g.textAlign = 'left';
    }
    if (pvp && s.hitMarker > 0) {
      g.strokeStyle = `rgba(255,80,80,${Math.min(1, s.hitMarker * 5)})`;
      g.lineWidth = 3;
      g.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.moveTo(cx + dx * 8, cy + dy * 8);
        g.lineTo(cx + dx * 18, cy + dy * 18);
      }
      g.stroke();
    }

    // escala de apuntado (solo con armas a distancia)
    if (state.ladder) {
      const pxPerRad = this.h / 2 / Math.tan((state.fov * Math.PI) / 360);
      g.font = '600 13px sans-serif';
      g.textBaseline = 'middle';
      let lastLabelY = -Infinity;
      for (const mark of state.ladder) {
        const y = cy + Math.tan(mark.angle) * pxPerRad;
        if (y > this.h - 20) continue;
        g.strokeStyle = 'rgba(255,230,120,0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx - 14, y);
        g.lineTo(cx + 14, y);
        g.stroke();
        if (y - lastLabelY < 15) continue;
        lastLabelY = y;
        g.fillStyle = 'rgba(255,230,120,0.95)';
        g.textAlign = 'left';
        g.fillText(`${mark.distance} m`, cx + 20, y);
      }
    }
    g.shadowBlur = 0;
    g.textBaseline = 'alphabetic';

    // barra de carga (tensar arco, girar honda, preparar lanzamiento)
    if (state.draw > 0.005) {
      const bw = 260;
      const bx = cx - bw / 2;
      const by = this.h - 56;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(bx - 3, by - 3, bw + 6, 16);
      g.fillStyle = state.draw >= 0.98 ? '#8be28b' : '#f0c040';
      g.fillRect(bx, by, bw * state.draw, 10);
    }

    // inventario + vida
    const invX = 18;
    const invY = this.h - 120;
    drawInventory(g, state.inv, { x: invX, y: invY, infinite: state.infinite });
    if (pvp) drawHealthBar(g, s.hp, { x: invX, y: invY - 28, w: 254 });

    // marcador de entrenamiento / bajas
    g.textAlign = 'left';
    g.font = '600 16px sans-serif';
    if (!pvp) {
      const st = state.stats;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(14, 14, 330, 74);
      g.fillStyle = '#f3e9c6';
      g.fillText(`Tanda ${st.endNumber}: ${st.endScore}    Total: ${st.total} (${st.count})`, 26, 40);
      for (let i = 0; i < 6; i++) {
        const shot = st.end[i];
        const x = 26 + i * 50;
        g.fillStyle = shot ? RING_STYLE[shot.ring].bg : 'rgba(255,255,255,0.12)';
        g.fillRect(x, 50, 42, 28);
        if (shot) {
          g.fillStyle = RING_STYLE[shot.ring].fg;
          g.textAlign = 'center';
          g.fillText(shot.label, x + 21, 70);
          g.textAlign = 'left';
        }
      }
      this.drawWind(g, state.wind);
    } else {
      const me = s.players.get(s.myId);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(14, 14, 250, s.teams ? 62 : 36);
      g.fillStyle = '#f3e9c6';
      if (s.teams) {
        // escuadras: la meta es del equipo; se muestra la suma de cada escuadra y la tuya resaltada
        let x = 26;
        g.font = '700 16px sans-serif';
        // con muchas parejas no caben todas: tu equipo y el rival que va en cabeza
        const rival = s.teamKills.reduce((best, k, i) => (i !== s.myTeam && k > (s.teamKills[best] ?? -1) ? i : best), s.myTeam === 0 ? 1 : 0);
        const shown = s.teams > 4 ? [s.myTeam, rival] : [...Array(s.teams).keys()];
        for (const i of shown) {
          g.fillStyle = teamColor(i);
          const label = `${teamName(i)} ${s.teamKills[i] ?? 0}`;
          g.fillText(i === s.myTeam ? `[${label}]` : label, x, 36);
          x += g.measureText(label).width + 22;
        }
        g.fillStyle = '#f3e9c6';
        g.font = '14px sans-serif';
        g.fillText(`Meta ${s.killLimit} bajas · tú ${me?.k ?? 0}/${me?.d ?? 0}`, 26, 62);
      } else {
        g.fillText(`Bajas ${me?.k ?? 0}/${s.killLimit}    Muertes ${me?.d ?? 0}`, 26, 38);
      }
      // registro de bajas
      g.textAlign = 'right';
      g.font = '600 14px sans-serif';
      s.feed.forEach((f, i) => {
        const age = s.time - f.t;
        g.globalAlpha = Math.min(1, (8 - age) * 0.8);
        const tw = g.measureText(f.text).width;
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(this.w - 24 - tw - 8, 18 + i * 24 - 14, tw + 16, 22);
        g.fillStyle = '#fff';
        g.fillText(f.text, this.w - 24, 18 + i * 24);
      });
      g.globalAlpha = 1;
      g.textAlign = 'left';
      this.drawNet(g, state.latency);
    }

    // aviso de objeto cercano
    if (state.hint) {
      g.font = '700 18px sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,0.5)';
      const tw = g.measureText(state.hint).width;
      g.fillRect(cx - tw / 2 - 12, this.h - 128, tw + 24, 30);
      g.fillStyle = '#ffe08a';
      g.fillText(state.hint, cx, this.h - 107);
    }

    // PvP: muerte, tabla, ganador
    if (pvp) {
      if (!s.alive) {
        g.fillStyle = 'rgba(40,0,0,0.45)';
        g.fillRect(0, 0, this.w, this.h);
        g.textAlign = 'center';
        g.font = '800 44px sans-serif';
        g.fillStyle = '#ffb4a8';
        g.fillText(s.killerName ? `Te ha eliminado ${s.killerName}` : 'Has muerto', cx, cy - 10);
        g.font = '600 18px sans-serif';
        g.fillStyle = '#fff';
        g.fillText('Reapareces en unos segundos · Esc para cambiar de armas', cx, cy + 28);
      }
      if (s.banner) {
        g.textAlign = 'center';
        g.font = '800 40px sans-serif';
        g.fillStyle = '#ffd666';
        g.shadowColor = '#000';
        g.shadowBlur = 8;
        g.fillText(s.banner, cx, 120);
        g.shadowBlur = 0;
      }
      if (state.showScores) this.drawScores(g, s);
    }

    if (this.toastT > 0) {
      this.toastT -= state.dt;
      g.globalAlpha = Math.min(1, this.toastT * 2);
      g.textAlign = 'center';
      g.font = '700 26px sans-serif';
      g.fillStyle = '#fff';
      g.shadowColor = 'rgba(0,0,0,0.7)';
      g.shadowBlur = 6;
      g.fillText(this.toastText, cx, cy - 90);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    }
  }

  drawNet(g, latency) {
    g.textAlign = 'right';
    g.font = '12px sans-serif';
    g.fillStyle = latency > 150 ? '#ff8a80' : 'rgba(255,255,255,0.6)';
    g.fillText(`${latency} ms`, this.w - 14, this.h - 12);
    g.textAlign = 'left';
  }

  drawScores(g, s) {
    // por escuadras: agrupados por equipo, el que va ganando arriba
    const list = s.teams
      ? s.scoreList.sort((a, b) => (s.teamKills[b.team] ?? 0) - (s.teamKills[a.team] ?? 0) || a.team - b.team || b.k - a.k || a.d - b.d)
      : s.scoreList;
    const w = 420;
    const x = (this.w - w) / 2;
    const y = this.h * 0.2;
    g.fillStyle = 'rgba(8,16,12,0.85)';
    g.fillRect(x, y, w, 56 + list.length * 30);
    g.textAlign = 'left';
    g.font = '700 20px sans-serif';
    g.fillStyle = '#ffd666';
    g.fillText('Clasificación', x + 18, y + 34);
    g.font = '600 14px sans-serif';
    g.fillStyle = '#9fc9a2';
    g.textAlign = 'right';
    g.fillText('Bajas', x + w - 90, y + 34);
    g.fillText('Muertes', x + w - 18, y + 34);
    list.forEach((p, i) => {
      const yy = y + 68 + i * 30;
      g.textAlign = 'left';
      g.font = p.id === s.myId ? '800 17px sans-serif' : '600 17px sans-serif';
      g.fillStyle = p.id === s.myId ? '#ffe08a' : '#f3e9c6';
      if (s.teams) {
        g.fillStyle = teamColor(p.team);
        g.fillRect(x + 18, yy - 12, 6, 15);
        g.fillStyle = p.id === s.myId ? '#ffe08a' : '#f3e9c6';
        g.fillText(p.name, x + 32, yy);
      } else {
        g.fillText(`${i + 1}. ${p.name}`, x + 18, yy);
      }
      g.textAlign = 'right';
      g.fillText(String(p.k), x + w - 90, yy);
      g.fillText(String(p.d), x + w - 18, yy);
    });
    g.textAlign = 'left';
  }

  drawWind(g, wind) {
    const wx = this.w - 80;
    const wy = 70;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.arc(wx, wy, 48, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(wx, wy);
    g.rotate(wind.angle);
    const len = 10 + Math.min(1, wind.speed / 8) * 26;
    g.fillStyle = '#7ad1ff';
    g.beginPath();
    g.moveTo(0, -len);
    g.lineTo(11, -len + 16);
    g.lineTo(4, -len + 13);
    g.lineTo(4, len * 0.7);
    g.lineTo(-4, len * 0.7);
    g.lineTo(-4, -len + 13);
    g.lineTo(-11, -len + 16);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#f3e9c6';
    g.textAlign = 'center';
    g.font = '600 14px sans-serif';
    g.fillText(`${wind.speed.toFixed(1)} m/s`, wx, wy + 66);
    g.textAlign = 'left';
  }
}
