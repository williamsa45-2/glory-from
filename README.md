# Campo de Tiro con Arco · Entrenamiento + PvP online

Juego para el navegador con **teclado y ratón** y con **gafas VR** (WebXR: Meta Quest, Pico, Valve Index, HTC Vive/Focus, Windows Mixed Reality, Vision Pro…). Un único código para todo.

| Modo | Qué es |
|---|---|
| **Entrenamiento** | Campo de tiro con 5 dianas (10–70 m), viento, muñecos de paja y un **armero** con todas las armas. Munición infinita. Funciona sin servidor (la simulación corre en tu navegador). |
| **PvP online** | Arena multijugador en un servidor (tu VPS). Gana quien llegue a 15 bajas. Servidor autoritativo: el daño y los impactos los decide el servidor. |

## Cómo se lanza el hacha y la lanza
El **hacha no tiene modos**: un **clic corto golpea** y **mantener el clic y soltar la lanza** (en VR: golpea moviéndola con fuerza; lanza soltando el gatillo en movimiento). Los pasos de abajo son para la lanza.

1. Selecciónala (1/2 o Q).
2. Pulsa **F** (o **clic derecho**; en VR **B/Y**) para pasar a **modo LANZAR**: bajo el inventario aparece un aviso naranja «MODO LANZAR», junto a la mira «LANZAR · mantén clic y suelta» y el hueco muestra *LANZAR* en vez de *MELÉ*.
3. Mantén el clic izquierdo para cargar y **suelta** para lanzar (en VR: agarra con el gatillo y suelta mientras mueves la mano; sale con tu velocidad).
4. Sale de tu inventario pero **se queda en el suelo o clavada**: recógela con **E** (VR: agarre).

## Armas

| Arma | Cuerpo a cuerpo | Se lanza | Notas |
|---|---|---|---|
| **Espada** | ✔ | – | Comparte hueco con el hacha: **no se pueden llevar a la vez** |
| **Hacha** | ✔ | ✔ | **Sin modos**: clic corto = golpe, mantener y soltar = lanzar. Al lanzarla sale del inventario; **queda en el mundo** para recogerla |
| **Lanza** | ✔ | ✔ | Compatible con cualquier otra arma. Lanzada también queda en el mundo |
| **Arco** | – | – | 12 flechas. Comparte hueco con la ballesta y la honda |
| **Ballesta** | – | – | **Más alcance y daño, solo 6 virotes**, recarga lenta |
| **Honda** | – | – | Empiezas con **1 piedra**; se recogen más del suelo. Mantén para girarla, suelta para lanzar |

Hay **3 huecos**: cuerpo a cuerpo (espada *o* hacha), lanza y distancia (arco *o* ballesta *o* honda). Eso implementa las reglas de exclusión.
Todo lo disparado o lanzado se queda en el mundo: las flechas/virotes/piedras se recogen solas al pasar por encima (PvP) y las armas con **E** (VR: agarre). En PvP, si el hueco está ocupado el servidor no te deja coger otra arma (suelta la tuya con **X**). Al morir sueltas tus armas.

El **inventario siempre es visible**: en pantalla abajo a la izquierda (armas, munición, modo lanzar/melé y vida); en VR, en un panel sobre el mando libre.

## Jugar

```
npm install
npm start            # http://localhost:8080  (si 8080 está ocupado usa el siguiente puerto libre)
```
Elige **Entrenamiento** o **PvP online** en el menú. En PvP escoge antes tu equipo (también se cambia en pausa con Esc).

### Teclado y ratón
| Control | Acción |
|---|---|
| Ratón / WASD | Apuntar / moverte |
| Mayús (+ W) / Espacio | **Correr / saltar** (se puede subir a cajas y saltar los muros bajos) |
| Clic izq. (mantener) | Usar el arma: tensar el arco, girar la honda, preparar el lanzamiento; golpear con espada/lanza; hacha: clic corto golpea, mantener y soltar la lanza; disparar la ballesta |
| Clic der. | Zoom (armas a distancia) |
| 1 · 2 · 3 / Q / rueda | Cuerpo a cuerpo · lanza · distancia / siguiente arma |
| **F** o clic der. | **Lanza: cambiar a modo LANZAR** y volver a cuerpo a cuerpo (el hacha no tiene modos) |
| E / X | Recoger arma cercana / soltar la actual |
| Tab | Clasificación (PvP) |
| R · G · T · N | Entrenamiento: recoger todo · escala de apuntado · viento · reiniciar |
| Esc | Pausa (cambiar equipo, volver al menú) |

### VR
| Control | Acción |
|---|---|
| Mano dominante (ajustable en el menú) | Espada/hacha/lanza, ballesta y honda; gatillo |
| Arco | La mano libre lo sostiene; la otra tensa la cuerda con el gatillo. La flecha sale por la línea entre manos |
| Golpear | Mueve el arma con fuerza hacia el rival (cuenta la velocidad real de la hoja) |
| Lanzar | Modo lanzar (B/Y): gatillo agarrado y **suelta mientras mueves la mano** (sale con tu velocidad) |
| Agarre | Recoger el arma/objeto cercano |
| A·X / B·Y | Siguiente arma / lanzar ⇄ cuerpo a cuerpo |
| Stick izq. | Mover; **a fondo = correr** |
| Stick der. | Girar a saltos · **hacia delante = saltar** · clic suelta el arma (el clic del izq. recoge todo en entrenamiento) |

**Compatibilidad VR**: solo usa WebXR estándar. Se adapta a dos mandos (con o sin lateralidad reconocida), a un solo mando (el gatillo mantenido tensa/gira con el tiempo), a seguimiento de manos (pellizco = gatillo) y a mandos sin A/B (Vive, WMR: el clic del stick/touchpad cambia de arma).

## Abrirlo en las gafas
WebXR exige **contexto seguro** (HTTPS o `localhost`):
1. **Quest por cable**: `adb reverse tcp:8080 tcp:8080` y abre `http://localhost:8080` en el visor.
2. **Pruebas por Wi-Fi**: `npm run start:https` → en las gafas `https://<IP-del-PC>:8080` (acepta el aviso del certificado autofirmado).
3. **Visor conectado al PC** (Link/SteamVR/WMR): `http://localhost:8080` en Chrome o Edge → *ENTER VR*.
4. **Producción**: tu VPS con HTTPS (ver abajo).

## Desplegar el PvP en un VPS

Necesitas un dominio apuntando al VPS y HTTPS (para WebXR y para `wss://`). El servidor sirve la web y el WebSocket (`/ws`) en el mismo puerto, así que el cliente se conecta solo al mismo dominio.

**Opción A: Docker + Caddy (la más simple, HTTPS automático)**
```bash
git clone <tu repo> archery && cd archery
DOMAIN=juego.midominio.com docker compose -f deploy/docker-compose.yml up -d --build
```
Abre los puertos 80 y 443. Caddy obtiene y renueva el certificado solo.

**Opción B: systemd + nginx** (ver `deploy/archery.service` y `deploy/nginx.conf`)
```bash
sudo mkdir -p /opt/archery && sudo cp -r . /opt/archery && cd /opt/archery && sudo npm ci --omit=dev
sudo cp deploy/archery.service /etc/systemd/system/ && sudo systemctl enable --now archery
# nginx: copiar deploy/nginx.conf y `sudo certbot --nginx -d juego.midominio.com`
```

### Salas y modos de juego
El VPS es el servidor: la web y el WebSocket salen del mismo dominio, y los jugadores no necesitan configurar nada (el campo «Servidor» del menú solo sirve para apuntar a otro).
- **Pública**: aparece en la lista de «Salas abiertas». **Privada**: solo se entra con el código o el enlace de invitación. Siempre existe una sala pública permanente (`PUBLICA`).
- **Todos contra todos**: gana quien llegue primero a las bajas elegidas.
- **Por escuadras** (2–4: Rojo, Azul, Verde, Amarillo): sin fuego amigo; gana la escuadra cuyas bajas sumadas lleguen a la meta. Los jugadores entran equilibrados y pueden cambiar de escuadra desde la pausa (Esc), con un tiempo de espera y respetando el tamaño máximo de cada una.

Variables del servidor: `PORT`, `HOST`, `TRUST_PROXY=1` (IP real tras el proxy), `MAX_PLAYERS` (12), `MAX_PER_IP` (4), `ALLOWED_ORIGINS`.
`/healthz` devuelve el estado (jugadores, uptime). Una sola arena de hasta 12 jugadores; la simulación va a 60 Hz y difunde poses a 20 Hz.

### Qué valida el servidor (y qué no)
Valida: munición, cadencia, alcance del origen del disparo, exclusión de armas por hueco, recogida de objetos, golpes (alcance, línea de visión con los muros), velocidad máxima de movimiento, cargas de equipo, tamaño/frecuencia de mensajes, origen del WebSocket y conexiones por IP.
**No** hace compensación de latencia ni valida la posición exacta de las manos en VR (se confía en la pose del cliente, limitada en velocidad). Es un juego cooperativo/entre amigos, no un servidor competitivo anti-trampas.

## Estructura
```
index.html            menú, pausa y botón ENTER VR
server.mjs            servidor web (gzip, ETag) + WebSocket
server/net.js         sala PvP: conexiones, límites, ticks y snapshots
server/*.test.mjs     pruebas del simulador (20) y de integración por red
shared/               ← mismo código en servidor y navegador
  weapons.js          armas, huecos e inventario (reglas de exclusión)
  sim.js              simulación autoritativa (jugadores, proyectiles, melé, objetos, partida)
  physics.js          balística, puntuación de diana
  maps.js             campo de tiro y arena PvP (datos)
src/                  cliente (Three.js)
  main.js             menú, modos, bucle
  session.js          estado del jugador y eventos de la simulación
  net.js              transportes: bucle local (entrenamiento) y WebSocket (PvP)
  desktop.js, weaponControl.js   controles teclado/ratón y armas en primera persona
  vr.js               controles VR
  weaponModels.js     modelos (GLB de Blender + respaldo procedural), projectiles.js, items.js, avatars.js
  world.js, arena.js, environment.js, textures.js   escenarios, cielo/IBL, texturas
  hud.js, inventoryUi.js, scoreboard.js, audio.js, effects.js
assets/models/        sword, axe, spear, crossbow, bow (.glb) modelados en Blender
vendor/               three.js, GLTFLoader…
deploy/, Dockerfile   despliegue
```

## Pruebas
```
npm test         # 20 pruebas del simulador + integración por WebSocket (servidor real, bots)
```

## Ajustes rápidos
- Armas (daño, alcance, munición, cadencia): `shared/weapons.js`
- Mapas (dianas, arena, apariciones, objetos del suelo): `shared/maps.js`
- Límite de bajas, tiempo de reaparición: `shared/sim.js` (`KILL_LIMIT`, `RESPAWN_TIME`)
- Modelos: re-exporta los `.glb` de Blender a `assets/models/` (origen en la empuñadura, la punta hacia +Y de Blender = −Z en el juego)
