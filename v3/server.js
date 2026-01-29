const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = 8080;

/* =====================
   HTML
===================== */

const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>P2P</title>

<style>
  body {
    margin: 0;
    background: black;
    color: white;
    font-family: monospace;
  }

  .navbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 64px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 24px;
    background: black;
    z-index: 1000;
    box-sizing: border-box;
  }

  .logo {
    width: 80px;
    height: 55px;
  }

  .get-button {
    padding: 10px 14px;
    border: 2px solid #fff;
    background: transparent;
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
  }

  .get-button:hover {
    background: #fff;
    color: #000;
  }

  .content {
    margin-top: 96px;
    display: flex;
    justify-content: center;
  }

  .viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(10, 25px);
    gap: 0;
  }

  .cell {
    width: 25px;
    height: 25px;
    background: #111;
  }

  #metrics {
    color: #888;
    margin-bottom: 4px;
  }

  #status {
    color: #666;
    margin-bottom: 12px;
  }

  .seeder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .seed-btn {
    padding: 12px 20px;
    border: 2px solid #fff;
    background: transparent;
    color: #fff;
    cursor: pointer;
  }

  .seed-btn:hover {
    background: #fff;
    color: #000;
  }
</style>
</head>

<body>

<div class="navbar">
  <img src="/logo.svg" class="logo">
  <button class="get-button" id="mintBtn">Mint</button>
</div>

<div class="content" id="content"></div>

<script>
/* =====================
   URL + TOKEN
===================== */

const params = new URLSearchParams(window.location.search);
const nodeToken = params.get("node"); // URL-safe, no decode needed

const content = document.getElementById("content");
const mintBtn = document.getElementById("mintBtn");

/*
TOKEN RULE (LOCKED):
- Format: AAAANN
- A = random letter (a–z)
- NN = 01–99 (node id)
- Total length = 6
- ID = last two characters
*/

function randLetter() {
  return String.fromCharCode(97 + Math.floor(Math.random() * 26));
}

function generateToken() {
  const id = Math.floor(Math.random() * 99) + 1;
  const idStr = String(id).padStart(2, "0");
  return randLetter() + randLetter() + randLetter() + randLetter() + idStr;
}

function extractId(token) {
  if (!token || token.length !== 6) return null;
  const id = parseInt(token.slice(4), 10);
  return id >= 1 && id <= 99 ? id : null;
}

/* =====================
   MINT (viewer only)
===================== */

if (nodeToken) {
  mintBtn.style.display = "none";
} else {
  mintBtn.onclick = () => {
    const t = generateToken();
    window.open("/?node=" + t, "_blank");
  };
}

/* =====================
   VIEWER MODE
===================== */

if (!nodeToken) {
  const viewer = document.createElement("div");
  viewer.className = "viewer";

  const metrics = document.createElement("div");
  metrics.id = "metrics";

  const status = document.createElement("div");
  status.id = "status";

  const grid = document.createElement("div");
  grid.className = "grid";

  const cells = [];
  for (let i = 0; i < 100; i++) {
    const c = document.createElement("div");
    c.className = "cell";
    grid.appendChild(c);
    cells.push(c);
  }

  viewer.append(metrics, status, grid);
  content.appendChild(viewer);

  function colorFromToken(token) {
    let h = 0;
    for (let i = 0; i < token.length; i++) {
      h = token.charCodeAt(i) + ((h << 5) - h);
    }
    return \`hsl(\${Math.abs(h) % 360},70%,60%)\`;
  }

  const ws = new WebSocket("ws://" + location.host);

  ws.onmessage = e => {
    const alive = JSON.parse(e.data);
    const up = alive.filter(Boolean).length;

    metrics.innerText = \`up: \${up} / down: \${100 - up}\`;
    status.innerText = up === 0 ? "node unavailable" : "";

    cells.forEach((c, i) => {
      c.style.background = alive[i] ? colorFromToken(alive[i]) : "#111";
    });
  };
}

/* =====================
   SEEDER MODE
===================== */

if (nodeToken) {
  const seeder = document.createElement("div");
  seeder.className = "seeder";

  const id = extractId(nodeToken);

  const label = document.createElement("div");
  label.innerText = id ? "Node " + id : "Invalid node";

  const start = document.createElement("button");
  start.className = "seed-btn";
  start.innerText = "Start seeding";

  const stop = document.createElement("button");
  stop.className = "seed-btn";
  stop.innerText = "Stop seeding";

  seeder.append(label, start, stop);
  content.appendChild(seeder);

  let ws = null;

  start.onclick = () => {
    if (ws || !id) return;
    ws = new WebSocket("ws://" + location.host);
    ws.onopen = () => ws.send(JSON.stringify({ token: nodeToken }));
  };

  stop.onclick = () => {
    if (!ws) return;
    ws.close();
    ws = null;
  };
}
</script>

</body>
</html>
`;

/* =====================
   HTTP SERVER
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
    if (data.token) nodes.set(ws, data.token);
  });
  ws.on("close", () => nodes.delete(ws));
});

setInterval(() => {
  const alive = Array(100).fill(null);

  for (const token of nodes.values()) {
    const id = extractServerId(token);
    if (id !== null) alive[id] = token;
  }

  const payload = JSON.stringify(alive);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  });
}, 300);

function extractServerId(token) {
  if (!token || token.length !== 6) return null;
  const id = parseInt(token.slice(4), 10);
  return id >= 1 && id <= 99 ? id : null;
}

server.listen(PORT, () => {
  console.log("v3 running at http://localhost:" + PORT);
});
