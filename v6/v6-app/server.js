const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const WebSocket = require("ws");
const { ethers } = require("ethers");

dotenv.config();

const PORT = Number(process.env.PORT || 8080);

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONFIG_PATH = path.join(APP_DIR, "contract-config.json");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const rpcUrl =
  process.env.SEPOLIA_RPC ||
  process.env.PUBLIC_SEPOLIA_RPC ||
  config.readRpc ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const provider = new ethers.JsonRpcProvider(rpcUrl, config.chainId || 11155111);
const nodeLookup = new ethers.Contract(
  config.address,
  ["function nodeOf(address) view returns (uint256)"],
  provider
);

const app = express();
app.use(express.static(PUBLIC_DIR));
app.get("/contract-config.json", (_req, res) => {
  res.sendFile(CONFIG_PATH);
});
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log("v6 running -> http://localhost:" + PORT);
});

const wss = new WebSocket.Server({ server });
const activeSeeders = new Map(); // ws -> { wallet, node }
const wsChallenge = new Map(); // ws -> nonce

function seedMessage(nonce) {
  return `P2P v6 seeding authorization\nNonce: ${nonce}`;
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function alivePayload() {
  const alive = {};
  for (const { node, wallet } of activeSeeders.values()) {
    alive[node] = wallet;
  }
  return { type: "alive", alive };
}

function broadcastAlive() {
  const payload = JSON.stringify(alivePayload());
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function clearConnection(ws) {
  const hadActive = activeSeeders.delete(ws);
  wsChallenge.delete(ws);
  if (hadActive) {
    broadcastAlive();
  }
}

async function verifySeederAuth(data, nonce) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid auth payload");
  }
  if (!Number.isInteger(data.node)) {
    throw new Error("Invalid node");
  }
  if (typeof data.wallet !== "string" || !data.wallet) {
    throw new Error("Invalid wallet");
  }
  if (typeof data.signature !== "string" || !data.signature) {
    throw new Error("Invalid signature");
  }
  if (data.nonce !== nonce) {
    throw new Error("Invalid nonce");
  }

  const wallet = ethers.getAddress(data.wallet);
  const recovered = ethers.verifyMessage(seedMessage(nonce), data.signature);
  if (ethers.getAddress(recovered) !== wallet) {
    throw new Error("Signature mismatch");
  }

  const nodeId = Number(await nodeLookup.nodeOf(wallet));
  if (nodeId !== data.node || nodeId < 1 || nodeId > 100) {
    throw new Error("Node ownership mismatch");
  }

  return { wallet, node: nodeId };
}

wss.on("connection", (ws) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  wsChallenge.set(ws, nonce);

  sendJson(ws, { type: "challenge", nonce });
  sendJson(ws, alivePayload());

  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      sendJson(ws, { type: "error", message: "Invalid JSON payload" });
      return;
    }

    if (data.type === "seed-auth") {
      const expectedNonce = wsChallenge.get(ws);
      if (!expectedNonce) {
        sendJson(ws, { type: "error", message: "Missing challenge" });
        return;
      }

      try {
        const verified = await verifySeederAuth(data, expectedNonce);
        activeSeeders.set(ws, verified);
        wsChallenge.delete(ws);

        sendJson(ws, {
          type: "seed-ack",
          node: verified.node,
          wallet: verified.wallet,
        });
        broadcastAlive();
      } catch (error) {
        sendJson(ws, { type: "error", message: error.message || "Auth failed" });
      }
      return;
    }

    if (data.type === "seed-stop") {
      const hadActive = activeSeeders.delete(ws);
      if (hadActive) {
        broadcastAlive();
      }
      return;
    }

    if (data.type === "ping") {
      sendJson(ws, { type: "pong" });
    }
  });

  ws.on("close", () => {
    clearConnection(ws);
  });
  ws.on("error", () => {
    clearConnection(ws);
  });
});
