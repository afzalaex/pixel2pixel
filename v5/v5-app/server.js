const express = require("express");
const WebSocket = require("ws");
const path = require("path");

const PORT = 8080;

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log("v6 running → http://localhost:" + PORT);
});

/* =====================
   WEBSOCKETS
===================== */

const wss = new WebSocket.Server({ server });
const active = new Map(); // ws → { node, wallet }

wss.on("connection", ws => {
  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg);
      active.set(ws, data);
    } catch {}
  });

  ws.on("close", () => {
    active.delete(ws);
  });
});

setInterval(() => {
  const alive = {};
  for (const { node, wallet } of active.values()) {
    alive[node] = wallet;
  }

  const payload = JSON.stringify(alive);

  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(payload);
    }
  });
}, 300);



