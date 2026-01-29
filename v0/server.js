const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });
const nodes = new Map(); // nodeId -> ws

wss.on("connection", ws => {
  let nodeId = null;

  ws.on("message", msg => {
    const data = JSON.parse(msg);
    nodeId = data.id;
    nodes.set(nodeId, ws);
  });

  ws.on("close", () => {
    if (nodeId !== null) {
      nodes.delete(nodeId);
    }
  });
});

// broadcast alive nodes
setInterval(() => {
  const alive = [...nodes.keys()];
  const payload = JSON.stringify(alive);

  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(payload);
    }
  });
}, 500);

console.log("Server running at ws://localhost:8080");

