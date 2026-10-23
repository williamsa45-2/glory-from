# Reconocimiento de manos para el arco (MediaPipe)

En **Entrenamiento** (un jugador) puedes tirar con el arco usando las manos delante de la cámara, como un arquero:

- **Mano dominante (la de la cuerda)**: derecha si eres **diestro**, izquierda si eres **zurdo**. **Pellizca (pulgar + índice) para tensar y abre los dedos para disparar.**
- **La otra mano (la del arco)** maneja la vista siempre:
  - **Sin tensar** hace de joystick: el sitio donde la enseñas es el centro (círculo verde en el recuadro). Apártala hacia un lado, arriba o abajo y la vista gira hacia allí, más rápido cuanto más lejos. Vuelve al círculo, o escóndela, para parar.
  - **Tensando** pasa a apuntado fino: la puntería se mueve lo mismo que la mano. Al disparar, el centro del joystick pasa a donde tengas la mano.
- No hace falta ratón, aunque sigue funcionando. Con una sola mano a la vista, esa es la que tensa y giras con el ratón.

Funciona también con honda, ballesta y el lanzamiento de hacha y lanza (el pellizco sustituye al clic izquierdo).

Todo corre en tu navegador: el vídeo no sale del equipo y **no hace falta internet** (los archivos de abajo ya están en el proyecto).

## Uso
1. Arranca el juego (`npm start`) y ábrelo en `http://localhost:8080` o por **HTTPS**. Los navegadores solo dan la cámara en `localhost` o HTTPS (con la IP del PC por `http://` no funciona).
2. En el menú principal, justo debajo de los botones, marca **«Tirar con las manos (cámara)»**, elige **Diestro** o **Zurdo** y pulsa **Entrenamiento**.
   Si ya estás jugando: pulsa **Esc** y en la pausa usa **«Activar control con las manos»** (ahí también puedes cambiar diestro/zurdo).
3. Acepta el permiso de la cámara. Abajo en el centro aparece un recuadro con tu imagen en espejo y los puntos de la mano.
4. Selecciona el arco (`3` o `Q`), pellizca para tensar y abre para disparar.

Consejos: buena luz, mano entera visible y a 40–80 cm de la cámara, palma o canto hacia ella. Si el pellizco no se detecta, acércate un poco. En el recuadro, la mano de la cuerda sale en azul (amarillo al pellizcar) y la del arco en verde. Si se confunden, separa bien las manos, cada una a su lado del cuerpo.

## Archivos incluidos (MediaPipe Tasks Vision 0.10.14)
| Archivo | Para qué |
|---|---|
| `vision_bundle.mjs` | Librería JavaScript |
| `wasm/vision_wasm_internal.{js,wasm}` | Motor (navegadores con SIMD, casi todos) |
| `wasm/vision_wasm_nosimd_internal.{js,wasm}` | Motor de respaldo sin SIMD |
| `hand_landmarker.task` | Modelo de detección de manos (float16, ~8 MB) |

Licencia: Apache 2.0 (Google LLC). El peso total es de unos 27 MB.

## Reinstalar / actualizar los archivos
Desde la raíz del proyecto (Git Bash, Linux o macOS con `curl`):
```bash
V=0.10.14
B=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$V
mkdir -p vendor/mediapipe/wasm && cd vendor/mediapipe
curl -fsSLO $B/vision_bundle.mjs
for f in vision_wasm_internal.js vision_wasm_internal.wasm vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  curl -fsSL $B/wasm/$f -o wasm/$f
done
curl -fsSLO https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```
En PowerShell, sustituye `curl -fsSL` por `Invoke-WebRequest -OutFile`.

## Si algo falla
| Mensaje | Causa y solución |
|---|---|
| «Permiso de cámara denegado» | Permite la cámara en el candado de la barra de direcciones y recarga |
| «Este navegador no permite usar la cámara» | Abre el juego por `localhost` o HTTPS |
| «No se pudo abrir la cámara» | Otra app la está usando, o no hay cámara |
| «No se pudo cargar el reconocimiento de manos» | Faltan archivos en `vendor/mediapipe/`: reinstálalos con los comandos de arriba. Comprueba que `/vendor/mediapipe/hand_landmarker.task` descarga (no 404) |
| Va a trompicones | Cierra pestañas pesadas; usa Chrome o Edge (aceleración GPU) |

## En el VPS
No hace falta nada extra: `vendor/` se sirve y se sube con el repositorio (Docker lo copia con el resto). La página debe ir por HTTPS (Nginx Proxy Manager o Caddy) para que el navegador deje usar la cámara.
