#!/usr/bin/env bash
# Construye y levanta el juego. Sirve para HTTP y para HTTPS:
#   - DOMINIO vacío en .env  -> HTTP en PUERTO_WEB (por IP).
#   - DOMINIO definido       -> HTTPS con Caddy y certificado automático.
# Uso (desde la raíz del repo): ./deploy/levantar.sh
set -euo pipefail

[ -f .env ] || { echo "Falta .env: cp .env.produccion.example .env y editarlo."; exit 1; }

archivos=(-f docker-compose.yml)
if grep -qE '^DOMINIO=.+' .env; then
  archivos+=(-f docker-compose.https.yml)
  echo "Modo HTTPS ($(grep -E '^DOMINIO=' .env | cut -d= -f2))"
else
  echo "Modo HTTP (sin DOMINIO)"
fi

docker compose "${archivos[@]}" up -d --build --remove-orphans
docker compose "${archivos[@]}" ps

# da el despliegue por bueno solo si el juego responde
for _ in $(seq 1 20); do
  if docker compose "${archivos[@]}" exec -T game wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "Juego respondiendo (healthz OK)"; exit 0
  fi
  sleep 2
done
docker compose "${archivos[@]}" logs --tail 50 game >&2
echo "El juego no respondió tras el despliegue" >&2
exit 1
