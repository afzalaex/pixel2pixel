const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = 8080;

/* =====================
   MOCK OWNERSHIP
===================== */

const OWNERS = {
  wallet1: 12,
  wallet2: 37,
  wallet3: 58,
  wallet4: 60,
  wallet5: 70
};

/* =====================
   HTML
===================== */

const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>P2P v4</title>

<style>
body {
  margin: 0;
  background: black;
  color: white;
  font-family: monospace;
}

.navbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 64px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  background: black;
  z-index: 10;
}

.logo {
  width: 80px;
  height: 55px;
}

button {
  padding: 10px 14px;
  border: 2px solid #fff;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

button:hover {
  background: #fff;
  color: #000;
}

.content {
  margin-top: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(10, 40px);
}

.cell {
  width: 40px;
  height: 40px;
  background: #111;
}

.meta {
  color: #777;
  font-size: 14px;
}

.wallets {
  color: #aaa;
  font-size: 13px;
  max-width: 420px;
  text-align: center;
}

.seeder {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
</style>
</head>

<body>

<div class="navbar">
  <img src="/logo.svg" class="logo">
  <button id="connect">Connect</button>
</div>

<div class="content">
  <div id="metrics" class="meta"></div>
  <div class="grid" id="grid"></div>
  <div id="status" class="meta"></div>
  <div id="wallets" class="wallets"></div>
  <div id="seeder" class="seeder"></div>
</div>

<script>
/* =====================
   STATE
===================== */

const OWNERS = ${JSON.stringify(OWNERS)};
let wallet = null;
let seedWs = null;

/* =====================
   HELPERS
===================== */

function nodeOf(w) {
  return OWNERS[w] || null;
}

function colorFromNode(node) {
  const hue = (node * 137) % 360;
  return \`hsl(\${hue},70%,60%)\`;
}

/* =====================
   WALLET CONNECT (MOCK)
===================== */

document.getElementById("connect").onclick = () => {
  const keys = Object.keys(OWNERS);
  wallet = keys[(keys.indexOf(wallet) + 1) % keys.length];
  document.getElementById("connect").innerText = wallet;
  renderSeeder();
};

/* =====================
   GRID (ALWAYS ON)
===================== */

const grid = document.getElementById("grid");
const cells = [];

for (let i = 1; i <= 100; i++) {
  const c = document.createElement("div");
  c.className = "cell";
  grid.appendChild(c);
  cells.push(c);
}

/* =====================
   UI ELEMENTS
===================== */

const metrics = document.getElementById("metrics");
const status = document.getElementById("status");
const walletsDiv = document.getElementById("wallets");
const seederDiv = document.getElementById("seeder");

status.innerText = "Connect wallet to participate";

/* =====================
   WEBSOCKET (VIEW)
===================== */

const ws = new WebSocket("ws://" + location.host);

ws.onmessage = e => {
  const alive = JSON.parse(e.data);
  const upNodes = Object.keys(alive);

  metrics.innerText =
    \`up: \${upNodes.length} / down: \${100 - upNodes.length}\`;

  status.innerText =
    upNodes.length === 0 ? "node unavailable" : "";

  walletsDiv.innerText =
    upNodes.length
      ? "active wallets: " + upNodes.map(n => alive[n]).join(", ")
      : "";

  cells.forEach((c, i) => {
    const node = i + 1;
    if (alive[node]) {
      c.style.background = colorFromNode(node);
      c.title = alive[node];
    } else {
      c.style.background = "#111";
      c.title = "";
    }
  });
};

/* =====================
   SEEDER UI (CONDITIONAL)
===================== */

function renderSeeder() {
  seederDiv.innerHTML = "";

  if (!wallet) return;

  const node = nodeOf(wallet);
  if (!node) return;

  const label = document.createElement("div");
  label.className = "meta";
  label.innerText = "Node " + node;

  const start = document.createElement("button");
  start.innerText = "Start seeding";

  const stop = document.createElement("button");
  stop.innerText = "Stop seeding";

  seederDiv.append(label, start, stop);

  start.onclick = () => {
    if (seedWs) return;
    seedWs = new WebSocket("ws://" + location.host);
    seedWs.onopen = () => {
      seedWs.send(JSON.stringify({ node, wallet }));
    };
  };

  stop.onclick = () => {
    if (!seedWs) return;
    seedWs.close();
    seedWs = null;
  };
}
</script>

</body>
</html>
`;

/* =====================
   SERVER
===================== */

const server = http.createServer((req, res) => {
  if (req.url === "/logo.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(fs.readFileSync(path.join(__dirname, "logo.svg")));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

/* =====================
   WEBSOCKETS
===================== */

const wss = new WebSocket.Server({ server });
const nodes = new Map();

wss.on("connection", ws => {
  ws.on("message", msg => {
    const data = JSON.parse(msg);
    nodes.set(ws, data);
  });
  ws.on("close", () => nodes.delete(ws));
});

setInterval(() => {
  const alive = {};
  for (const { node, wallet } of nodes.values()) {
    alive[node] = wallet;
  }
  const payload = JSON.stringify(alive);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}, 300);

server.listen(PORT, () => {
  console.log("v4 single-page running → http://localhost:" + PORT);
});
