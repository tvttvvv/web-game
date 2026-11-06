import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { Game, bindSocket } from '../public/js/core/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PER_IP = 6;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
  if (p === '/__pc_server') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

const game = new Game({ hash: (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16), log: console.log });

const wss = new WebSocketServer({ server, maxPayload: 16384, perMessageDeflate: false });
const ipCount = new Map();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || '?';
  const n = (ipCount.get(ip) || 0) + 1;
  if (n > MAX_PER_IP) { ws.close(4003, 'too many'); return; }
  ipCount.set(ip, n);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const sock = bindSocket(game, ws);
  ws.on('message', (data) => sock.receive(data.toString()));
  ws.on('close', () => {
    ipCount.set(ip, Math.max(0, (ipCount.get(ip) || 1) - 1));
    sock.closed();
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.tick(dt);
}, 50);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
