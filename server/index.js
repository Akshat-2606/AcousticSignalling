const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = app.listen(PORT, () => {
  const lanIp = getLanIp();
  console.log(`audio-image-link server listening on:`);
  console.log(`  http://localhost:${PORT}`);
  if (lanIp) console.log(`  http://${lanIp}:${PORT}  (share this with the other device)`);
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
