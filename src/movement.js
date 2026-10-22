// Física vertical del jugador (compartida por escritorio y VR): gravedad, salto y subirse a cajas/muros bajos.
export const GRAVITY = 20; // m/s²
export const JUMP_SPEED = 7.2; // → ~1,3 m de altura: salta muros bajos (1,2 m) y cajas
export const WALK_SPEED = 3.2;
export const RUN_SPEED = 5.8;

export function createBody() {
  return { y: 0, vy: 0, grounded: true };
}

/**
 * Avanza la caída/salto un paso. `supportAt(feetY)` devuelve la altura del suelo bajo los pies
 * (0 o la cara superior de una caja que se pueda pisar desde esa altura).
 */
export function stepVertical(body, dt, supportAt, wantJump) {
  if (wantJump && body.grounded) {
    body.vy = JUMP_SPEED;
    body.grounded = false;
  }
  body.vy -= GRAVITY * dt;
  const ground = supportAt(body.y);
  let ny = body.y + body.vy * dt;
  if (ny <= ground) {
    ny = ground;
    if (body.vy < 0) body.vy = 0;
    body.grounded = true;
  } else {
    body.grounded = false;
  }
  body.y = ny;
}
