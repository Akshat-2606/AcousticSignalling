// WebSocket signaling client + role-based UI wiring.

(() => {
  let myId = null;
  let myRole = null;
  let receiver = null;

  const el = {
    myId: document.getElementById('my-id'),
    myRole: document.getElementById('my-role'),
    roster: document.getElementById('roster'),
    senderPanel: document.getElementById('sender-panel'),
    receiverPanel: document.getElementById('receiver-panel'),
    imageInput: document.getElementById('image-input'),
    sendBtn: document.getElementById('send-btn'),
    sendProgress: document.getElementById('send-progress'),
    sendStats: document.getElementById('send-stats'),
    originalPreview: document.getElementById('original-preview'),
    receiverStatus: document.getElementById('receiver-status'),
    receivedPreview: document.getElementById('received-preview'),
    receivedStats: document.getElementById('received-stats'),
  };

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'hello') {
      myId = msg.id;
      el.myId.textContent = myId;
    }

    if (msg.type === 'roster') {
      renderRoster(msg.devices);
    }

    if (msg.type === 'role_assigned') {
      myRole = msg.role;
      el.myRole.textContent = myRole || '(none)';
      applyRole(myRole);
    }
  });

  function renderRoster(devices) {
    el.roster.innerHTML = '';
    devices.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'roster-row';

      const label = document.createElement('span');
      label.textContent = `${d.id} (${d.ip})${d.id === myId ? ' — this device' : ''} — role: ${d.role || 'none'}`;
      row.appendChild(label);

      ['sender', 'receiver', 'none'].forEach((roleOption) => {
        const btn = document.createElement('button');
        btn.textContent = roleOption;
        btn.disabled = (d.role || 'none') === roleOption;
        btn.addEventListener('click', () => {
          ws.send(
            JSON.stringify({
              type: 'assign_role',
              targetId: d.id,
              role: roleOption === 'none' ? null : roleOption,
            })
          );
        });
        row.appendChild(btn);
      });

      el.roster.appendChild(row);
    });
  }

  function applyRole(role) {
    el.senderPanel.classList.toggle('hidden', role !== 'sender');
    el.receiverPanel.classList.toggle('hidden', role !== 'receiver');

    if (role === 'receiver' && !receiver) {
      startReceiving();
    }
  }

  async function startReceiving() {
    el.receiverStatus.textContent = 'requesting microphone access...';
    receiver = Decoder.createReceiver({
      onStatus: (status, extra) => {
        if (status === 'listening') el.receiverStatus.textContent = 'listening for transmission...';
        if (status === 'synced') el.receiverStatus.textContent = 'preamble detected, syncing...';
        if (status === 'receiving')
          el.receiverStatus.textContent = `receiving: ${extra.received}/${extra.total} bytes`;
        if (status === 'done')
          el.receiverStatus.textContent = `done. CRC ${extra.crcOk ? 'OK' : 'FAILED'} (${extra.byteLength} bytes)`;
      },
      onDone: ({ crcOk, imageUrl, byteLength }) => {
        el.receivedPreview.src = imageUrl;
        el.receivedStats.textContent = `${byteLength} bytes received, CRC ${crcOk ? 'passed' : 'FAILED'}`;
      },
    });
    try {
      await receiver.start();
    } catch (err) {
      el.receiverStatus.textContent = `mic error: ${err.message}`;
    }
  }

  el.imageInput.addEventListener('change', () => {
    const file = el.imageInput.files[0];
    if (!file) return;
    el.originalPreview.src = URL.createObjectURL(file);
    el.sendBtn.disabled = false;
  });

  el.sendBtn.addEventListener('click', async () => {
    el.sendBtn.disabled = true;
    el.sendProgress.textContent = 'compressing...';
    const startedAt = performance.now();

    const stats = await Encoder.sendImage(el.originalPreview, {
      onProgress: (sent, total) => {
        el.sendProgress.textContent = `transmitting: symbol ${sent}/${total}`;
      },
      onDone: () => {
        const elapsedMs = Math.round(performance.now() - startedAt);
        el.sendProgress.textContent = 'transmission complete';
        el.sendStats.textContent += ` | actual elapsed: ${elapsedMs} ms`;
        el.sendBtn.disabled = false;
      },
    });

    el.sendStats.textContent = `${stats.payloadBytes} bytes (${stats.width}x${stats.height}) as ${stats.symbolCount} symbols, expected transmit time: ${stats.transmitMs} ms`;
  });
})();
