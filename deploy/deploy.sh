#!/usr/bin/env bash
# Se ejecuta EN EL VPS (lo lanza el workflow tras subir el código): reconstruye la imagen y reinicia el juego.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Falta deploy/.env (DOMAIN=tu.dominio.com). Ejecuta deploy/setup-vps.sh" >&2; exit 1; }
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
# espera a que el juego responda antes de dar el despliegue por bueno
for _ in $(seq 1 20); do
  if docker compose exec -T game wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "Despliegue OK"; exit 0
  fi
  sleep 2
done
docker compose logs --tail 50 game >&2
echo "El juego no respondió tras el despliegue" >&2
exit 1
