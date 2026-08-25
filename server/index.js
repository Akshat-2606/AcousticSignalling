const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const express = require('express');
const selfsigned = require('selfsigned');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3443;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const { cert, key } = getOrCreateCert();
const server = https.createServer({ cert, key }, app).listen(PORT, () => {
  const lanIp = getLanIp();
  console.log(`audio-image-link server listening on:`);
  console.log(`  https://localhost:${PORT}`);
  if (lanIp) console.log(`  https://${lanIp}:${PORT}  (share this with the other device)`);
  console.log(`Uses a self-signed certificate — your browser will warn on first visit.`);
  console.log(`Click "Advanced" -> "Proceed" (or "visit this website") to accept it; this`);
  console.log(`is required for microphone access (getUserMedia needs a secure context).`);
});

const wss = new WebSocketServer({ server });

/** @type {Map<string, {id: string, ip: string, role: string|null, ws: import('ws').WebSocket}>} */
const devices = new Map();

let nextId = 1;

wss.on('connection', (ws, req) => {
  const id = `dev-${nextId++}`;
  const ip = normalizeIp(req.socket.remoteAddress);
  devices.set(id, { id, ip, role: null, ws });

  ws.send(JSON.stringify({ type: 'hello', id }));
  broadcastRoster();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'assign_role' && typeof msg.targetId === 'string') {
      const target = devices.get(msg.targetId);
      if (!target) return;
      if (msg.role !== 'sender' && msg.role !== 'receiver' && msg.role !== null) return;
      target.role = msg.role;
      if (target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify({ type: 'role_assigned', role: target.role }));
      }
      broadcastRoster();
    }
  });

  ws.on('close', () => {
    devices.delete(id);
    broadcastRoster();
  });
});

function broadcastRoster() {
  const roster = Array.from(devices.values()).map(({ id, ip, role }) => ({ id, ip, role }));
  const payload = JSON.stringify({ type: 'roster', devices: roster });
  for (const device of devices.values()) {
    if (device.ws.readyState === device.ws.OPEN) {
      device.ws.send(payload);
    }
  }
}

function normalizeIp(addr) {
  if (!addr) return 'unknown';
  return addr.replace('::ffff:', '');
}

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function getOrCreateCert() {
  const certDir = path.join(__dirname, 'certs');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  const attrs = [{ name: 'commonName', value: 'audio-image-link.local' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [{ name: 'basicConstraints', cA: true }],
  });

  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);

  return { cert: pems.cert, key: pems.private };
}
