#!/usr/bin/env bash
# Preparación ÚNICA del VPS (Ubuntu/Debian), como root o con sudo:
#   curl -fsSL https://raw.githubusercontent.com/<usuario>/<repo>/main/deploy/setup-vps.sh | sudo DOMAIN=juego.midominio.com DEPLOY_USER=deploy bash
# (o copia el archivo y ejecútalo). Instala Docker y rsync, crea el usuario de despliegue y la configuración.
set -euo pipefail
: "${DOMAIN:?define DOMAIN=tu.dominio.com (debe apuntar ya a la IP de este VPS)}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

apt-get update -y
apt-get install -y rsync curl ca-certificates ufw
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/glory-from/deploy"
echo "DOMAIN=$DOMAIN" > "/home/$DEPLOY_USER/glory-from/deploy/.env"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/glory-from/deploy/.env"

# cortafuegos: SSH + web (80/443, incluido HTTP/3)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

cat <<MSG

Listo. Falta:
  1. Añadir la clave PÚBLICA de despliegue a /home/$DEPLOY_USER/.ssh/authorized_keys
  2. En GitHub (Settings > Secrets > Actions): VPS_HOST, VPS_USER=$DEPLOY_USER, VPS_SSH_KEY (clave privada)
  3. Hacer push a main (o lanzar el workflow "Deploy" a mano)
MSG
