// Servidor estático + servidor de juego PvP (WebSocket en /ws).
//   node server.mjs            -> http://localhost:8080   (escritorio, y gafas por USB con "adb reverse")
//                                  (si 8080 está ocupado usa el siguiente puerto libre; PORT=xxxx fija uno)
//   node server.mjs --https    -> https://<IP-del-PC>:8080 (pruebas con gafas por Wi-Fi: WebXR exige HTTPS)
//
// En un VPS: ejecútalo detrás de un proxy inverso con HTTPS (Caddy/nginx), ver deploy/.
//   PORT=3000 HOST=127.0.0.1 TRUST_PROXY=1 node server.mjs
//
// Variables de entorno:
//   PORT, HOST          puerto y dirección de escucha (por defecto 8080 y 0.0.0.0)
//   TRUST_PROXY=1       confía en X-Forwarded-For (IP real de los jugadores detrás del proxy)
//   ALLOWED_ORIGINS     orígenes extra permitidos para el WebSocket, separados por comas (por defecto, solo el propio host)
//   MAX_PLAYERS         jugadores simultáneos en la arena (por defecto 12)
//   MAX_PER_IP          conexiones simultáneas por IP (por defecto 4)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { attachGameServer } from './server/net.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const useHttps = process.argv.includes('--https');
const trustProxy = process.env.TRUST_PROXY === '1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
};
const compressible = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.glb']);
const gzipCache = new Map(); // ruta -> { etag, buffer }

const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

function isHidden(rel) {
  return (
    ['node_modules', 'server', 'deploy'].includes(rel[0]) ||
    rel.some((p) => p.startsWith('.')) ||
    /^package/.test(rel[0]) ||
    rel[0] === 'server.mjs' ||
    rel[0] === 'Dockerfile'
  );
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status' || url.pathname === '/healthz') {
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(game.status()));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ rooms: game.listRooms() }));
    return;
  }
  if (url.pathname === '/api/info') {
    // para el enlace de invitación: si el anfitrión juega en localhost, sus amigos necesitan la IP de la red local
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ lanIps: host === '0.0.0.0' ? lanIps : [], lan: host === '0.0.0.0' ? lanAddrs : [], port: server.address()?.port, https: useHttps }));
    return;
  }
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403, baseHeaders).end('Forbidden');
    return;
  }
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  const rel = path.relative(root, file).split(path.sep);
  if (isHidden(rel)) {
    res.writeHead(404, baseHeaders).end('Not found');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, baseHeaders).end('Not found');
      return;
    }
    const ext = path.extname(file);
    const etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = {
      ...baseHeaders,
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache', // siempre revalida, pero con ETag responde 304 sin reenviar el archivo
      ETag: etag,
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    const wantsGzip = compressible.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, baseHeaders).end('Not found');
        return;
      }
      if (!wantsGzip) {
        res.writeHead(200, headers);
        res.end(data);
        return;
      }
      const cached = gzipCache.get(file);
      const send = (buffer) => {
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
        res.end(buffer);
      };
      if (cached && cached.etag === etag) {
        send(cached.buffer);
        return;
      }
      zlib.gzip(data, { level: 9 }, (zErr, buffer) => {
        if (zErr) {
          res.writeHead(200, headers);
          res.end(data);
          return;
        }
        gzipCache.set(file, { etag, buffer });
        send(buffer);
      });
    });
  });
}

// IPs de este equipo en la red local, la más probable primero (Wi-Fi/Ethernet real antes que adaptadores
// virtuales o la zona Wi-Fi compartida de Windows, 192.168.137.x), para el enlace de invitación
const lanRank = (name, address) => {
  if (/vethernet|virtual|vmware|vbox|hyper-v|docker|wsl|bluetooth|loopback/i.test(name)) return 4;
  if (address.startsWith('192.168.137.')) return 3;
  if (/wi-?fi|wlan|wireless|inal[áa]mbrica/i.test(name)) return 0;
  if (/ethernet|^eth|^en/i.test(name)) return 1;
  return 2;
};
const lanAddrs = Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })))
  .sort((a, b) => lanRank(a.name, a.address) - lanRank(b.name, b.address));
const lanIps = lanAddrs.map((i) => i.address);

let server;
if (useHttps) {
  const { default: selfsigned } = await import('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 30,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...lanIps.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  server = https.createServer({ key: pems.private, cert: pems.cert }, handler);
} else {
  server = http.createServer(handler);
}

const game = attachGameServer(server, {
  maxPlayers: Number(process.env.MAX_PLAYERS) || 12,
  maxPerIp: Number(process.env.MAX_PER_IP) || 4,
  trustProxy,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});

// Si el puerto está ocupado o reservado (EADDRINUSE / EACCES en Windows), prueba con el siguiente.
const MAX_TRIES = 30;
function listen(p, attempt = 0) {
  const onError = (err) => {
    server.off('listening', onListening);
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && attempt < MAX_TRIES && !process.env.PORT) {
      console.log(`Puerto ${p} no disponible (${err.code}), probando ${p + 1}...`);
      listen(p + 1, attempt + 1);
    } else {
      console.error(`No se pudo abrir el puerto ${p}: ${err.message}`);
      process.exit(1);
    }
  };
  const onListening = () => {
    server.off('error', onError);
    const scheme = useHttps ? 'https' : 'http';
    console.log(`Campo de tiro listo:\n  ${scheme}://localhost:${p}`);
    if (host === '0.0.0.0') for (const ip of lanIps) console.log(`  ${scheme}://${ip}:${p}`);
    if (useHttps) console.log('\nEn las gafas acepta el aviso del certificado ("Avanzado > Continuar").');
    else if (host === '0.0.0.0') console.log(`\nGafas por USB: adb reverse tcp:${p} tcp:${p}  y abre http://localhost:${p} en el visor.`);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(p, host);
}
listen(port);

// cierre ordenado (systemd / docker stop)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig}: cerrando…`);
    game.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
