const http = require("http");
const WebSocket = require("ws");

const PORT = 8080;

// --- HTML PAGE (viewer + seeder) ---
const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>P2P Puzzle</title>
  <style>
    body {
      background: black;
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      font-family: monospace;
    }
    #status {
      color: #666;
      margin-bottom: 4px;
    }
    #metrics {
      color: #888;
      margin-bottom: 10px;
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
  </style>
</head>
<body>

<div id="ui">
  <div id="status"></div>
  <div id="metrics"></div>
  <div class="grid" id="grid"></div>
</div>

<script>
  const params = new URLSearchParams(location.search);
  const nodeId = params.has("id") ? Number(params.get("id")) : null;

if (nodeId !== null) {
  document.getElementById("ui").style.display = "none";
}

  function colorFromId(id) {
    const hue = (id * 137) % 360;
    return \`hsl(\${hue}, 70%, 60%)\`;
  }

  const GRID_SIZE = 100;
  const grid = document.getElementById("grid");
  const status = document.getElementById("status");
  const metrics = document.getElementById("metrics");
  const cells = [];

  for (let i = 0; i < GRID_SIZE; i++) {
    const d = document.createElement("div");
    d.className = "cell";
    grid.appendChild(d);
    cells.push(d);
  }

  const ws = new WebSocket("ws://" + location.host);

  ws.onopen = () => {
    if (nodeId !== null) {
      ws.send(JSON.stringify({ id: nodeId }));
    }
  };

  ws.onmessage = e => {
    const alive = JSON.parse(e.data);

    const up = alive.length;
    const down = GRID_SIZE - up;

    metrics.innerText = \`up: \${up} / down: \${down}\`;
    status.innerText = up === 0 ? "node unavailable" : "";

    cells.forEach((cell, i) => {
      cell.style.background = alive.includes(i)
        ? colorFromId(i)
        : "#111";
    });
  };
</script>

</body>
</html>
`;

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocket.Server({ server });
const nodes = new Map(); // ws -> nodeId

wss.on("connection", ws => {
  ws.on("message", msg => {
    const data = JSON.parse(msg);
    if (typeof data.id === "number") {
      nodes.set(ws, data.id);
    }
  });

  ws.on("close", () => {
    nodes.delete(ws);
  });
});

// broadcast state
setInterval(() => {
  const alive = [...nodes.values()];
  const payload = JSON.stringify(alive);

  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(payload);
    }
  });
}, 300);

server.listen(PORT, () => {
  console.log("Running at http://localhost:" + PORT);
});
