// Transportes del cliente. El juego habla siempre con una "simulación autoritativa" a través de mensajes:
//  - LoopbackTransport: entrenamiento. La simulación (shared/sim.js) corre aquí mismo, sin red.
//  - WsTransport: PvP. La simulación corre en el servidor del VPS.

export class LoopbackTransport {
  constructor(sim, { id = 'me', name = 'Tú', loadout } = {}) {
    this.sim = sim;
    this.id = id;
    this.name = name;
    this.loadout = loadout;
    this.onmessage = null;
    this.latency = 0;
    this.connected = true;
  }

  start() {
    this.sim.emit = (msg, to) => {
      if (to === undefined || to === this.id || (Array.isArray(to) && to.includes(this.id))) this.onmessage?.(msg);
    };
    this.sim.addPlayer(this.id, { name: this.name, loadout: this.loadout });
  }

  send(msg) {
    this.sim.handle(this.id, msg);
  }

  update(dt) {
    this.sim.update(dt);
  }
}

export class WsTransport {
  /** room: código de la sala a la que unirse · create: ajustes para crear una sala nueva (y entrar en ella) */
  constructor(url, { name, loadout, room = '', create = null }) {
    this.url = url;
    this.name = name;
    this.loadout = loadout;
    this.roomCode = room;
    this.create = create;
    this.room = null; // { code, name, players, max, killLimit, public } al entrar
    this.onmessage = null;
    this.onclose = null;
    this.latency = 0;
    this.connected = false;
    this.ws = null;
    this.pingTimer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ t: 'join', name: this.name, loadout: this.loadout, room: this.roomCode || undefined, create: this.create || undefined }));
        this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') {
          this.latency = Math.round(performance.now() - msg.c);
          return;
        }
        if (msg.t === 'welcome' && !settled) {
          settled = true;
          resolve();
        }
        if (msg.t === 'room') {
          this.room = msg;
          return;
        }
        const refusal = { full: 'La sala está llena', no_room: 'No existe ninguna sala con ese código (revísalo o pide uno nuevo)', too_many_rooms: 'El servidor ya tiene demasiadas salas abiertas; prueba más tarde' }[msg.t];
        if (refusal && !settled) {
          settled = true;
          reject(new Error(refusal));
        }
        this.onmessage?.(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('No se pudo conectar con el servidor'));
        }
      };
      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        if (!settled) {
          settled = true;
          reject(new Error('Conexión cerrada por el servidor'));
        }
        this.onclose?.();
      };
    });
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  update() {}

  close() {
    this.ws?.close();
  }
}
