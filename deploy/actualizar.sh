#!/usr/bin/env bash
# Actualiza el VPS a la última versión de main (HTTP o HTTPS según DOMINIO en .env).
# Uso (desde la raíz del repo): ./deploy/actualizar.sh
set -euo pipefail
git pull --ff-only
./deploy/levantar.sh
docker image prune -f
