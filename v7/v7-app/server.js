const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const WebSocket = require("ws");
const { ethers } = require("ethers");

dotenv.config();

const MAX_NODES = 100;
const PORT = Number(process.env.PORT || 8080);

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONFIG_PATH = path.join(APP_DIR, "contract-config.json");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
if (!config.nodes || !config.nodes.address) {
  throw new Error("Missing nodes.address in contract-config.json");
}

const rpcUrl =
  process.env.SEPOLIA_RPC ||
  process.env.PUBLIC_SEPOLIA_RPC ||
  config.readRpc ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const chainId = Number(config.chainId || 11155111);
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);

const nodes = new ethers.Contract(
  config.nodes.address,
  [
    "function nodeOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function nextTokenId() view returns (uint256)",
    "function roundId() view returns (uint256)",
    "function gameActive() view returns (bool)"
  ],
  provider
);

const auction =
  config.finalAuction &&
  config.finalAuction.address &&
  typeof config.finalAuction.address === "string" &&
  config.finalAuction.address.length > 0
    ? new ethers.Contract(
        config.finalAuction.address,
        ["function finalized() view returns (bool)"],
        provider
      )
    : null;

const app = express();
app.use(express.static(PUBLIC_DIR));
app.get("/contract-config.json", (_req, res) => {
  res.sendFile(CONFIG_PATH);
});

const activeSeeders = new Map(); // ws -> { wallet, node }
const wsChallenge = new Map(); // ws -> nonce

let wss = null;
let chainState = {
  totalSupply: 0,
  gameActive: false,
  roundId: 1
};
let auctionFinalized = false;
let gameActiveSupported = true;
let roundIdSupported = true;
let terminalFrozen = false;
let frozenAlive = {};
let terminalSnapshot = null;
let syncInFlight = null;

function seedMessage(nonce) {
  return `P2P v7 seeding authorization\nNonce: ${nonce}`;
}

function randomNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function issueChallenge(ws) {
  const nonce = randomNonce();
  wsChallenge.set(ws, nonce);
  sendJson(ws, { type: "challenge", nonce });
}

function buildLiveAlive() {
  const alive = {};
  for (const { node, wallet } of activeSeeders.values()) {
    alive[node] = wallet;
  }
  return alive;
}

function currentAlive() {
  return terminalFrozen ? frozenAlive : buildLiveAlive();
}

function currentNodeIds() {
  return Object.keys(currentAlive())
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_NODES)
    .sort((a, b) => a - b);
}

function shuffleReady() {
  return Boolean(terminalSnapshot) && auctionFinalized;
}

function payloadForClients() {
  const alive = currentAlive();
  return {
    type: "alive",
    alive,
    totalSupply: chainState.totalSupply,
    gameActive: chainState.gameActive,
    roundId: chainState.roundId,
    activeSeeders: Object.keys(alive).length,
    terminal: terminalFrozen,
    snapshot: terminalSnapshot,
    shuffleReady: shuffleReady()
  };
}

function broadcastRoundState() {
  if (!wss) return;
  const payload = JSON.stringify(payloadForClients());
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

async function readTotalSupply() {
  try {
    return Number(await nodes.totalSupply());
  } catch {
    const nextTokenId = Number(await nodes.nextTokenId());
    return Math.max(nextTokenId - 1, 0);
  }
}

async function readGameActive() {
  if (!gameActiveSupported) {
    return chainState.gameActive;
  }

  try {
    return Boolean(await nodes.gameActive());
  } catch {
    gameActiveSupported = false;
    return chainState.gameActive;
  }
}

async function readRoundId() {
  if (!roundIdSupported) {
    return chainState.roundId;
  }

  try {
    return Number(await nodes.roundId());
  } catch {
    roundIdSupported = false;
    return chainState.roundId;
  }
}

async function readAuctionFinalized() {
  if (!auction) return false;
  try {
    return Boolean(await auction.finalized());
  } catch {
    return false;
  }
}

function clearOffchainRoundState() {
  terminalFrozen = false;
  terminalSnapshot = null;
  frozenAlive = {};
  activeSeeders.clear();
  wsChallenge.clear();

  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      issueChallenge(client);
    }
  }
}

async function buildSnapshotFromAlive(alive) {
  const nodeIds = Object.keys(alive)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_NODES)
    .sort((a, b) => a - b);

  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const timestamp = Number(block && block.timestamp ? block.timestamp : Math.floor(Date.now() / 1000));
  const packed = ethers.solidityPacked(
    ["uint256", "uint256", "uint256[]"],
    [BigInt(blockNumber), BigInt(timestamp), nodeIds.map((id) => BigInt(id))]
  );
  const seedHash = ethers.keccak256(packed);

  return {
    blockNumber,
    timestamp,
    nodeIds,
    seedHash
  };
}

function dropConflictingSeeders(ws, verified) {
  for (const [client, entry] of activeSeeders.entries()) {
    if (client === ws) continue;
    if (entry.node === verified.node || entry.wallet === verified.wallet) {
      activeSeeders.delete(client);
      sendJson(client, { type: "seed-revoked", message: "Seeder session replaced." });
    }
  }
}

async function syncRoundState() {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const [totalSupply, gameActive, roundId, finalized] = await Promise.all([
      readTotalSupply(),
      readGameActive(),
      readRoundId(),
      readAuctionFinalized()
    ]);

    const previousRoundId = chainState.roundId;
    chainState = { totalSupply, gameActive, roundId };
    auctionFinalized = finalized;

    if (terminalSnapshot && roundIdSupported && roundId > previousRoundId) {
      clearOffchainRoundState();
      return;
    }

    if (!terminalFrozen) {
      const alive = buildLiveAlive();
      const activeCount = Object.keys(alive).length;
      if (totalSupply === MAX_NODES && activeCount === MAX_NODES) {
        terminalFrozen = true;
        frozenAlive = { ...alive };
        terminalSnapshot = await buildSnapshotFromAlive(alive);
      }
    }
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

async function verifySeederAuth(data, nonce) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid auth payload");
  }
  if (!Number.isInteger(data.node) || data.node < 1 || data.node > MAX_NODES) {
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

  const nodeId = Number(await nodes.nodeOf(wallet));
  if (nodeId !== data.node || nodeId < 1 || nodeId > MAX_NODES) {
    throw new Error("Node ownership mismatch");
  }

  const owner = ethers.getAddress(await nodes.ownerOf(nodeId));
  if (owner !== wallet) {
    throw new Error("Node ownership mismatch");
  }

  return { wallet, node: nodeId };
}

function clearConnection(ws) {
  const hadActive = activeSeeders.delete(ws);
  wsChallenge.delete(ws);
  if (hadActive && !terminalFrozen) {
    syncRoundState()
      .then(() => broadcastRoundState())
      .catch((error) => {
        console.error("sync failed on disconnect", error);
      });
  }
}

app.get("/healthz", async (_req, res) => {
  try {
    await syncRoundState();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "health check failed" });
  }
});

app.get("/round-state", async (_req, res) => {
  try {
    await syncRoundState();
    const payload = payloadForClients();
    delete payload.type;
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch round state" });
  }
});

const server = app.listen(PORT, () => {
  console.log("v7 running -> http://localhost:" + PORT);
});

wss = new WebSocket.Server({ server });
wss.on("connection", (ws) => {
  issueChallenge(ws);
  sendJson(ws, payloadForClients());

  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      sendJson(ws, { type: "error", message: "Invalid JSON payload" });
      return;
    }

    if (data.type === "seed-auth") {
      if (terminalFrozen) {
        sendJson(ws, { type: "error", message: "Seeding frozen: terminal state reached" });
        return;
      }

      const expectedNonce = wsChallenge.get(ws);
      if (!expectedNonce) {
        sendJson(ws, { type: "error", message: "Missing challenge" });
        return;
      }

      try {
        const verified = await verifySeederAuth(data, expectedNonce);
        dropConflictingSeeders(ws, verified);
        activeSeeders.set(ws, verified);
        wsChallenge.delete(ws);

        sendJson(ws, {
          type: "seed-ack",
          node: verified.node,
          wallet: verified.wallet
        });

        await syncRoundState();
        broadcastRoundState();
      } catch (error) {
        sendJson(ws, { type: "error", message: error.message || "Auth failed" });
      }
      return;
    }

    if (data.type === "seed-stop") {
      if (terminalFrozen) {
        sendJson(ws, { type: "error", message: "Seeding frozen: terminal state reached" });
        return;
      }

      const hadActive = activeSeeders.delete(ws);
      issueChallenge(ws);
      if (hadActive) {
        await syncRoundState();
        broadcastRoundState();
      }
      return;
    }

    if (data.type === "ping") {
      sendJson(ws, { type: "pong", activeNodes: currentNodeIds() });
      return;
    }

    sendJson(ws, { type: "error", message: "Unsupported message type" });
  });

  ws.on("close", () => {
    clearConnection(ws);
  });
  ws.on("error", () => {
    clearConnection(ws);
  });
});

syncRoundState()
  .then(() => {
    broadcastRoundState();
  })
  .catch((error) => {
    console.error("initial round sync failed", error);
  });

setInterval(() => {
  syncRoundState()
    .then(() => {
      broadcastRoundState();
    })
    .catch((error) => {
      console.error("periodic round sync failed", error);
    });
}, 8000);
