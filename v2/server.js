const http = require("http");
const WebSocket = require("ws");

const PORT = 8080;

// ---------------- HTML ----------------
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
    justify-content: center;
    align-items: center;
    font-family: monospace;
    color: #fff;
  }

  /* viewer */
  #viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  #metrics {
    margin-bottom: 10px;
    font-size: 11px;
    opacity: 0.85;
    letter-spacing: 0.5px;
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
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 6px;
    line-height: 1;
    color: #fff;
    user-select: none;
  }

  /* seeder */
  #seeder {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  button {
    background: none;
    border: 1px solid #555;
    color: #aaa;
    padding: 6px 16px;
    cursor: pointer;
    font-family: monospace;
  }

  button:hover {
    border-color: #888;
    color: #fff;
  }
</style>
</head>

<body>

<div id="viewer">
  <div id="metrics"></div>
  <div class="grid" id="grid"></div>
</div>

<div id="seeder">
  <div id="nodeLabel"></div>
  <button id="toggle">Play</button>
</div>

<script>
  const params = new URLSearchParams(location.search);
  const nodeId = params.has("id") ? Number(params.get("id")) : null;

  const viewer = document.getElementById("viewer");
  const seeder = document.getElementById("seeder");

  const GRID_SIZE = 100;
  const grid = document.getElementById("grid");
  const metrics = document.getElementById("metrics");
  const cells = [];

  function colorFromId(id) {
    const hue = (id * 137) % 360;
    return \`hsl(\${hue}, 70%, 60%)\`;
  }

  // build grid
  for (let i = 0; i < GRID_SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    grid.appendChild(cell);
    cells.push(cell);
  }

  let ws = null;
  let seeding = false;

  // ---------- SEEDER MODE ----------
  if (nodeId !== null) {
    viewer.style.display = "none";
    seeder.style.display = "flex";

    document.getElementById("nodeLabel").innerText = "node " + nodeId;
    const btn = document.getElementById("toggle");

    btn.onclick = () => {
      if (!seeding) {
        ws = new WebSocket("ws://" + location.host);
        ws.onopen = () => {
          ws.send(JSON.stringify({ id: nodeId }));
          seeding = true;
          btn.innerText = "Stop";
        };
        ws.onclose = () => {
          seeding = false;
          btn.innerText = "Play";
        };
      } else {
        ws.close();
      }
    };
  }

  // ---------- VIEWER MODE ----------
  if (nodeId === null) {
    ws = new WebSocket("ws://" + location.host);

    ws.onmessage = e => {
      const alive = JSON.parse(e.data);

      const up = alive.length;
      const down = GRID_SIZE - up;
      metrics.innerText = \`up: \${up} / down: \${down}\`;

      cells.forEach((cell, i) => {
        if (alive.includes(i)) {
          cell.style.background = colorFromId(i);
          cell.textContent = "";
        } else {
          cell.style.background = "#111";
          cell.textContent = "404";
        }
      });
    };
  }
</script>

</body>
</html>
`;

// ---------------- SERVER ----------------
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

// ---------------- WS ----------------
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
