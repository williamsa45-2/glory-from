// Control con las manos por cámara (entrenamiento): MediaPipe Hand Landmarker detecta las manos en el navegador.
// Como un arquero de verdad: la mano dominante (derecha si eres diestro, izquierda si eres zurdo) pellizca la cuerda
// (pulgar + índice) para tensar y la suelta para disparar; la otra mano sostiene el arco y maneja la vista: sin tensar hace de
// joystick (apartarla de su centro gira la vista) y, mientras tensas, moverla afina la puntería.
// Nada sale del equipo: el vídeo se procesa en local y todo se sirve desde vendor/mediapipe/ (ver su README.md).
const MP_BASE = new URL('../vendor/mediapipe', import.meta.url).href;
const MODEL_URL = `${MP_BASE}/hand_landmarker.task`;

const PINCH_ON = 0.32; // distancia pulgar–índice / tamaño de la mano para considerar «pellizco»
const PINCH_OFF = 0.5; // histéresis: hasta que no se abren más no se suelta
const LOST_GRACE = 0.25; // s sin ver la mano antes de soltar (evita disparos por un parpadeo del seguimiento)
const AIM_GAIN = 1.1; // rad de giro por anchura completa de imagen que se mueve la mano del arco
const AIM_SMOOTH = 0.45; // suavizado de la mano del arco (0 = nada, 1 = congelada)
const AIM_JUMP = 0.12; // saltos mayores entre fotogramas son fallos del seguimiento: se ignoran
const STEER_DEAD = 0.06; // joystick: zona muerta alrededor del centro (fracción de imagen) en la que la vista no gira
const STEER_FULL = 0.18; // distancia extra desde la zona muerta hasta la velocidad máxima
const STEER_YAW_SPEED = 2.0; // rad/s de giro horizontal a fondo
const STEER_PITCH_SPEED = 1.2; // rad/s de giro vertical a fondo

const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const SIDE_NAME = { right: 'derecha', left: 'izquierda' };
const LOAD_TIMEOUT = 25000; // ms: si el modelo no carga en este tiempo se avisa en vez de quedarse esperando

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
/** Webcam elegida (o la frontal); si no existe o no admite la resolución pedida, cualquier cámara. */
/** Webcam frontal; si la resolución pedida no la admite, cualquier cámara. */
async function openCamera(deviceId) {
  const explain = (e) => {
    const why = {
      NotAllowedError: 'Permiso de cámara denegado: permítela en el candado de la barra de direcciones y vuelve a activarla',
      SecurityError: 'Permiso de cámara denegado: permítela en el candado de la barra de direcciones y vuelve a activarla',
      NotFoundError: 'No se encontró ninguna cámara conectada',
      NotReadableError: 'La cámara está en uso por otra aplicación (Zoom, Teams, OBS…): ciérrala y vuelve a activarla',
      AbortError: 'La cámara está en uso por otra aplicación: ciérrala y vuelve a activarla',
    }[e?.name];
    return new Error(why ?? `No se pudo abrir la cámara (${e?.name || e})`);
  };
  try {
    const video = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } } : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    if (e?.name !== 'OverconstrainedError' && e?.name !== 'TypeError') throw explain(e);
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch((e) => {
    throw explain(e);
  });
}

/** Carga MediaPipe desde vendor/: primero con GPU y, si falla o se atasca, con CPU. */
async function loadLandmarker() {
  let mp;
  try {
    mp = await import(`${MP_BASE}/vision_bundle.mjs`);
  } catch (e) {
    console.error('[manos]', e);
    throw new Error('No se pudo cargar vendor/mediapipe/vision_bundle.mjs (¿falta el archivo?)');
  }
  const fileset = await withTimeout(mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`), LOAD_TIMEOUT, 'El motor de reconocimiento (wasm) no carga: revisa vendor/mediapipe/wasm');
  const make = (delegate) => withTimeout(
    mp.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
    LOAD_TIMEOUT,
    `El modelo de manos (${delegate}) tarda demasiado en cargar`
  );
  try {
    return await make('GPU');
  } catch (e) {
    console.warn('[manos] GPU no disponible, se usa CPU:', e);
    return make('CPU').catch((err) => {
      console.error('[manos]', err);
      throw new Error('No se pudo cargar el modelo de manos (vendor/mediapipe/hand_landmarker.task)');
    });
  }
}

export class HandControl {
  /** @param {{ hand?: 'right' | 'left' }} opts mano dominante: la que tensa la cuerda */
  constructor({ hand = 'right', deviceId = '' } = {}) {
    this.deviceId = deviceId; // cámara elegida ('' = la frontal por defecto)
    this.hand = hand;
    this.pinch = false; // true mientras la mano de la cuerda mantiene el pellizco
    this.hands = 0; // manos detectadas
    this.aimYaw = 0; // giro pendiente de aplicar (rad), lo consume takeAim()
    this.aimPitch = 0;
    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.root = null;
    this.ctx = null;
    this.lastVideoTime = -1;
    this.lost = 0;
    this.noHands = 0; // s seguidos con la cámara funcionando pero sin ver ninguna mano
    this.drawState = false; // pellizco de la mano de la cuerda (con histéresis)
    this.bowPos = null; // posición suavizada de la mano del arco
    this.neutral = null; // centro del joystick de la mano del arco
    this.wasDrawing = false;
    this.aspect = 4 / 3;
    this.running = false;
  }

  /**
   * Abre la cámara y carga el modelo. El recuadro aparece desde el primer momento y dice en qué paso está;
   * si algo falla, el error se queda escrito en él (los avisos del HUD no se ven con la pausa abierta).
   */
  async start() {
    this.buildPreview();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(`El navegador solo deja usar la cámara por HTTPS o localhost: abre http://localhost:${location.port || 80}`);
      }
      this.setStatus('Pidiendo permiso para la cámara…');
      this.stream = await openCamera(this.deviceId);
      this.cameraName = this.stream.getVideoTracks()[0]?.label ?? '';
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {}); // muted: no debería fallar; si falla, update() espera a que haya imagen
      this.setStatus('Cámara encendida · cargando el reconocimiento de manos…');
      this.landmarker = await loadLandmarker();
      this.running = true;
      this.setStatus(`Muestra la mano ${SIDE_NAME[this.hand]} a la cámara`);
    } catch (e) {
      console.error('[manos]', e);
      this.fail(e.message || 'No se pudo activar la cámara');
      throw e;
    }
  }

  setStatus(text, error = false) {
    if (!this.label) return;
    this.label.textContent = text;
    this.label.style.background = error ? 'rgba(170,30,30,.9)' : 'rgba(0,0,0,.55)';
  }

  /** Apaga la cámara pero deja el recuadro con el error unos segundos para que se pueda leer. */
  fail(message) {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.setStatus(message, true);
    const root = this.root;
    this.root = null;
    setTimeout(() => root?.remove(), 12000);
  }

  buildPreview() {
    const root = document.createElement('div');
    // por encima de la pausa (z-index 5) para que se vea la cámara y los avisos aunque el juego esté en pausa
    root.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:240px;height:180px;z-index:30;pointer-events:none;border:2px solid #3d5b43;border-radius:10px;overflow:hidden;background:#000;opacity:.92';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1)'; // espejo, como un espejo real
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1)';
    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:2px 6px;font:600 11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);text-align:center;transform:none';
    root.append(video, canvas, label);
    document.body.append(root);
    this.root = root;
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.label = label;
  }

  /**
   * Reparte las manos detectadas en { draw, bow } (índices). MediaPipe etiqueta la lateralidad suponiendo imagen
   * en espejo; el vídeo de la webcam llega sin espejar, así que «Left» es la mano derecha real de la persona.
   */
  assign(landmarks, handedness) {
    const side = (i) => {
      const name = handedness?.[i]?.[0]?.categoryName;
      return name === 'Left' ? 'right' : name === 'Right' ? 'left' : null;
    };
    if (landmarks.length === 1) return { draw: 0, bow: -1 }; // con una sola mano a la vista, esa tensa
    const [a, b] = [side(0), side(1)];
    if (a && b && a !== b) return a === this.hand ? { draw: 0, bow: 1 } : { draw: 1, bow: 0 };
    // etiquetas dudosas: decide la posición; sin espejo, la mano derecha real sale a la izquierda de la imagen (x menor)
    const rightIdx = landmarks[0][0].x < landmarks[1][0].x ? 0 : 1;
    const draw = this.hand === 'right' ? rightIdx : 1 - rightIdx;
    return { draw, bow: 1 - draw };
  }

  /** Llamar cada fotograma; actualiza `pinch` y acumula la puntería de la mano del arco. */
  update(dt) {
    if (!this.running) return;
    if (this.video.readyState < 2) {
      this.video.play().catch(() => {});
      return;
    }
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      let res;
      try {
        res = this.landmarker.detectForVideo(this.video, performance.now());
      } catch (e) {
        console.error('[manos]', e);
        this.running = false;
        this.pinch = this.drawState = false;
        this.fail('El reconocimiento de manos falló en este navegador (prueba Chrome o Edge, o desactiva Shields en Brave)');
        return;
      }
      const hands = (res.landmarks ?? []).slice(0, 2);
      this.hands = hands.length;
      const aspect = this.video.videoWidth / (this.video.videoHeight || 1);
      const dist = (p, q) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
      const roles = hands.length ? this.assign(hands, res.handedness ?? res.handednesses) : { draw: -1, bow: -1 };

      if (roles.draw >= 0) {
        const lm = hands[roles.draw];
        const size = dist(lm[0], lm[9]) || 1; // muñeca → base del dedo corazón
        const ratio = dist(lm[4], lm[8]) / size; // punta del pulgar ↔ punta del índice
        this.drawState = ratio < (this.drawState ? PINCH_OFF : PINCH_ON);
        this.lost = this.noHands = 0;
        this.pinch = this.drawState;
      }
      this.aimWithBowHand(roles.bow >= 0 ? hands[roles.bow] : null, aspect);
      this.draw(hands, roles);
    }
    this.steerWithBowHand(dt);
    if (!this.hands) {
      // sin manos a la vista: se mantiene el pellizco un instante por si es un fallo puntual del seguimiento
      this.lost += dt;
      this.noHands += dt;
      if (this.lost >= LOST_GRACE) this.pinch = this.drawState = false;
    }
  }

  /**
   * La mano del arco controla la vista siempre:
   * - tensando: apuntado fino, la vista gira lo mismo que se mueve la mano (sin deriva: solo cuenta el desplazamiento);
   * - sin tensar: joystick (ver steerWithBowHand). El centro es donde aparece la mano, y se recoloca al disparar.
   */
  aimWithBowHand(lm, aspect) {
    if (!lm) {
      this.bowPos = this.neutral = null;
      return;
    }
    this.aspect = aspect;
    const raw = { x: lm[9].x, y: lm[9].y }; // base del dedo corazón: lo más estable de la mano
    if (!this.bowPos) {
      this.bowPos = this.neutral = raw;
      this.wasDrawing = this.pinch;
      return;
    }
    const next = { x: this.bowPos.x + (raw.x - this.bowPos.x) * (1 - AIM_SMOOTH), y: this.bowPos.y + (raw.y - this.bowPos.y) * (1 - AIM_SMOOTH) };
    const dx = next.x - this.bowPos.x;
    const dy = next.y - this.bowPos.y;
    this.bowPos = next;
    if (this.wasDrawing && !this.pinch) this.neutral = next; // tras disparar, la mano queda quieta donde esté
    this.wasDrawing = this.pinch;
    if (!this.pinch || Math.hypot(dx, dy) > AIM_JUMP) return;
    // imagen sin espejo: mover la mano a tu derecha baja x → girar a la derecha (yaw negativo)
    this.aimYaw += dx * AIM_GAIN;
    this.aimPitch -= (dy / aspect) * AIM_GAIN;
  }

  /** Joystick (sin tensar): apartar la mano del arco de su centro gira la vista, más rápido cuanto más lejos. */
  steerWithBowHand(dt) {
    if (this.pinch || !this.bowPos || !this.neutral) return;
    const axis = (d) => Math.sign(d) * Math.min(1, Math.max(0, Math.abs(d) - STEER_DEAD) / STEER_FULL);
    const sx = axis(this.bowPos.x - this.neutral.x);
    const sy = axis((this.bowPos.y - this.neutral.y) / (this.aspect || 1));
    this.aimYaw += sx * STEER_YAW_SPEED * dt;
    this.aimPitch -= sy * STEER_PITCH_SPEED * dt;
  }

  /** Devuelve y pone a cero el giro acumulado por la mano del arco. */
  takeAim() {
    const aim = { yaw: this.aimYaw, pitch: this.aimPitch };
    this.aimYaw = this.aimPitch = 0;
    return aim;
  }

  draw(hands, roles) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hands.forEach((lm, i) => {
      ctx.strokeStyle = i === roles.draw ? (this.pinch ? '#ffd23f' : '#7ad1ff') : '#7dde8a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      }
      ctx.stroke();
    });
    if (this.neutral && !this.pinch) {
      // centro del joystick y su zona muerta: dentro del círculo la vista no gira
      ctx.strokeStyle = 'rgba(125,222,138,.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(this.neutral.x * canvas.width, this.neutral.y * canvas.height, STEER_DEAD * canvas.width, STEER_DEAD * canvas.width, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const cuerda = SIDE_NAME[this.hand];
    this.label.textContent = !hands.length
      ? this.noHands > 8
        ? 'No veo manos. ¿Ves una cámara tachada? Está apagada: tapa, tecla de cámara o privacidad de Windows'
        : `Muestra la mano ${cuerda} a la cámara`
      : this.pinch
        ? roles.bow >= 0 ? 'Tensando… mueve la mano del arco para apuntar' : 'Tensando… abre para disparar'
        : roles.bow >= 0 ? `Mano del arco: gira la vista · pellizca con la ${cuerda}` : `Pellizca con la ${cuerda} para tensar`;
  }

  stop() {
    this.running = false;
    this.pinch = this.drawState = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close?.();
    this.root?.remove();
    this.stream = null;
    this.landmarker = null;
    this.root = null;
  }
}

/** Cámaras del equipo ({ deviceId, label }); los nombres solo están disponibles tras dar permiso. */
export async function listCameras() {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) ?? [];
  return devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Cámara ${i + 1}` }));
}
