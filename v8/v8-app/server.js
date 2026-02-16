const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const WebSocket = require("ws");
const { ethers } = require("ethers");

dotenv.config();

const MAX_NODES = 100;
const GRID_COLUMNS = 10;
const CELL_SIZE = 60;
const CANVAS_SIZE = GRID_COLUMNS * CELL_SIZE;
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
    "function tokenURI(uint256) view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function nextTokenId() view returns (uint256)",
    "function roundId() view returns (uint256)",
    "function finalArtworkTokenIdByRound(uint256) view returns (uint256)",
    "function finalSnapshotHashByRound(uint256) view returns (bytes32)"
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
        [
          "function finalized() view returns (bool)",
          "function auctionActive() view returns (bool)",
          "function auctionEnd() view returns (uint256)",
          "function auctionRoundId() view returns (uint256)",
          "function snapshotHash() view returns (bytes32)",
          "function highestBidder() view returns (address)",
          "function highestBid() view returns (uint256)",
          "function pendingReturns(address) view returns (uint256)",
          "function hasBidInRound(uint256,address) view returns (bool)",
          "function owner() view returns (address)"
        ],
        provider
      )
    : null;

const finalArtwork =
  config.finalArtwork &&
  config.finalArtwork.address &&
  typeof config.finalArtwork.address === "string" &&
  config.finalArtwork.address.length > 0
    ? new ethers.Contract(
        config.finalArtwork.address,
        [
          "function tokenIdByRound(uint256) view returns (uint256)",
          "function ownerOf(uint256) view returns (address)",
          "function tokenURI(uint256) view returns (string)",
          "function roundByToken(uint256) view returns (uint256)",
          "function snapshotHashByToken(uint256) view returns (bytes32)",
          "function nextTokenId() view returns (uint256)"
        ],
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
const firstActivationByNode = new Map(); // node -> { wallet, activatedAt, activationOrder }

let activationOrderCounter = 0;
let wss = null;
let chainState = {
  totalSupply: 0,
  roundId: 1
};
let auctionFinalized = false;
let auctionRoundIdOnChain = 0;
let roundIdSupported = true;
let terminalFrozen = false;
let frozenAlive = {};
let terminalSnapshot = null;
let carryShuffleSeed = ethers.ZeroHash;
let carryShuffleSourceRound = 0;
let syncInFlight = null;
let finalSvgCache = {
  seedHash: "",
  svg: ""
};

const nodeColorCache = new Map();

function seedMessage(nonce) {
  return `P2P v8 seeding authorization\nNonce: ${nonce}`;
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

function snapshotForPayload() {
  if (!terminalSnapshot) {
    return null;
  }

  return {
    roundId: terminalSnapshot.roundId,
    blockNumber: terminalSnapshot.blockNumber,
    timestamp: terminalSnapshot.timestamp,
    nodeIds: terminalSnapshot.nodeIds,
    seedHash: terminalSnapshot.seedHash
  };
}

function deriveShuffleSeed(snapshotHash, roundId) {
  if (
    typeof snapshotHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(snapshotHash) ||
    snapshotHash === ethers.ZeroHash
  ) {
    return ethers.ZeroHash;
  }

  return ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint256"], [snapshotHash, BigInt(roundId)])
  );
}

function effectiveShuffleSeed() {
  if (terminalSnapshot && auctionFinalized) {
    return deriveShuffleSeed(terminalSnapshot.seedHash, terminalSnapshot.roundId);
  }
  return carryShuffleSeed;
}

function shuffleReady() {
  return effectiveShuffleSeed() !== ethers.ZeroHash;
}

function payloadForClients() {
  const alive = currentAlive();
  const activeShuffleSeed = effectiveShuffleSeed();
  const shuffleSourceRound =
    terminalSnapshot && auctionFinalized
      ? terminalSnapshot.roundId
      : carryShuffleSourceRound;

  return {
    type: "alive",
    alive,
    totalSupply: chainState.totalSupply,
    roundId: chainState.roundId,
    auctionRoundId: auctionRoundIdOnChain,
    auctionFinalizedCurrentRound: auctionFinalized,
    activeSeeders: Object.keys(alive).length,
    terminal: terminalFrozen,
    snapshot: snapshotForPayload(),
    shuffleSeed: activeShuffleSeed,
    shuffleSourceRound,
    awaitingAuction: Boolean(terminalSnapshot) && !auctionFinalized,
    shuffleReady: activeShuffleSeed !== ethers.ZeroHash
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

async function readAuctionFinalizationState(currentRoundId) {
  if (!auction) {
    return {
      finalized: false,
      auctionRoundId: 0,
      finalizedForCurrentRound: false
    };
  }

  try {
    const [finalizedRaw, auctionRoundRaw] = await Promise.all([
      auction.finalized(),
      auction.auctionRoundId()
    ]);
    const finalized = Boolean(finalizedRaw);
    const auctionRoundId = Number(auctionRoundRaw);

    return {
      finalized,
      auctionRoundId,
      finalizedForCurrentRound: finalized && auctionRoundId === currentRoundId
    };
  } catch {
    return {
      finalized: false,
      auctionRoundId: 0,
      finalizedForCurrentRound: false
    };
  }
}

function clearOffchainRoundState() {
  terminalFrozen = false;
  terminalSnapshot = null;
  frozenAlive = {};
  activeSeeders.clear();
  wsChallenge.clear();
  firstActivationByNode.clear();
  activationOrderCounter = 0;
  finalSvgCache = { seedHash: "", svg: "" };

  if (!wss) return;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      issueChallenge(client);
    }
  }
}

function recordActivation(verified) {
  const existing = firstActivationByNode.get(verified.node);
  if (!existing) {
    activationOrderCounter += 1;
    firstActivationByNode.set(verified.node, {
      wallet: verified.wallet,
      activatedAt: Math.floor(Date.now() / 1000),
      activationOrder: activationOrderCounter
    });
    return;
  }

  if (existing.wallet.toLowerCase() !== verified.wallet.toLowerCase()) {
    firstActivationByNode.set(verified.node, {
      ...existing,
      wallet: verified.wallet
    });
  }
}

function computeSnapshotHash(roundId, entriesByNode) {
  let rolling = ethers.keccak256(
    ethers.solidityPacked(["uint256"], [BigInt(roundId)])
  );

  for (const entry of entriesByNode) {
    rolling = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "uint256", "address", "uint256", "uint256"],
        [
          rolling,
          BigInt(entry.nodeId),
          entry.wallet,
          BigInt(entry.activatedAt),
          BigInt(entry.activationOrder)
        ]
      )
    );
  }

  return rolling;
}

async function refreshCarryShuffleSeed(roundId) {
  if (!Number.isInteger(roundId) || roundId <= 1) {
    carryShuffleSeed = ethers.ZeroHash;
    carryShuffleSourceRound = 0;
    return;
  }

  const previousRound = roundId - 1;
  try {
    const snapshotHash = await nodes.finalSnapshotHashByRound(previousRound);
    const nextSeed = deriveShuffleSeed(snapshotHash, previousRound);

    carryShuffleSeed = nextSeed;
    carryShuffleSourceRound = nextSeed === ethers.ZeroHash ? 0 : previousRound;
  } catch {
    carryShuffleSeed = ethers.ZeroHash;
    carryShuffleSourceRound = 0;
  }
}

async function buildTerminalSnapshot(alive) {
  const nodeIds = Object.keys(alive)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_NODES)
    .sort((a, b) => a - b);

  if (nodeIds.length !== MAX_NODES) {
    return null;
  }

  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const timestamp = Number(block && block.timestamp ? block.timestamp : Math.floor(Date.now() / 1000));

  const entriesByNode = nodeIds.map((nodeId) => {
    const wallet = ethers.getAddress(alive[nodeId]);
    const activation = firstActivationByNode.get(nodeId);

    if (!activation) {
      activationOrderCounter += 1;
      const fallback = {
        wallet,
        activatedAt: timestamp,
        activationOrder: activationOrderCounter
      };
      firstActivationByNode.set(nodeId, fallback);
      return {
        nodeId,
        wallet,
        activatedAt: fallback.activatedAt,
        activationOrder: fallback.activationOrder
      };
    }

    return {
      nodeId,
      wallet,
      activatedAt: Number(activation.activatedAt),
      activationOrder: Number(activation.activationOrder)
    };
  });

  const activationTrail = [...entriesByNode].sort((a, b) => {
    if (a.activationOrder !== b.activationOrder) {
      return a.activationOrder - b.activationOrder;
    }
    return a.nodeId - b.nodeId;
  });

  const seedHash = computeSnapshotHash(chainState.roundId, entriesByNode);

  return {
    roundId: chainState.roundId,
    blockNumber,
    timestamp,
    nodeIds,
    seedHash,
    entriesByNode,
    activationTrail
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

function decodeDataUri(payload, expectedPrefix) {
  if (typeof payload !== "string" || !payload.startsWith(expectedPrefix)) {
    throw new Error("Invalid data URI");
  }

  const base64 = payload.slice(expectedPrefix.length);
  return Buffer.from(base64, "base64").toString("utf8");
}

function decodeNodeSvg(tokenUri) {
  const metadataText = decodeDataUri(tokenUri, "data:application/json;base64,");
  const metadata = JSON.parse(metadataText);
  return decodeDataUri(metadata.image, "data:image/svg+xml;base64,");
}

function extractPrimaryFill(svgText) {
  const match = svgText.match(/fill=["'](#(?:[0-9a-fA-F]{6}))["']/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase();
}

function deterministicColor(nodeId) {
  const packed = ethers.solidityPacked(["uint256"], [BigInt(nodeId)]);
  const hash = ethers.getBytes(ethers.keccak256(packed));

  const r = Math.floor(hash[0] / 2) + 64;
  const g = Math.floor(hash[1] / 2) + 64;
  const b = Math.floor(hash[2] / 2) + 64;

  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

async function colorForNode(nodeId) {
  if (nodeColorCache.has(nodeId)) {
    return nodeColorCache.get(nodeId);
  }

  try {
    const tokenUri = await nodes.tokenURI(nodeId);
    const svg = decodeNodeSvg(tokenUri);
    const color = extractPrimaryFill(svg) || deterministicColor(nodeId);
    nodeColorCache.set(nodeId, color);
    return color;
  } catch {
    const fallback = deterministicColor(nodeId);
    nodeColorCache.set(nodeId, fallback);
    return fallback;
  }
}

async function buildFinalArtworkSvg(snapshot) {
  const colors = new Map();
  const nodeIds = [...snapshot.nodeIds].sort((a, b) => a - b);

  await Promise.all(
    nodeIds.map(async (nodeId) => {
      colors.set(nodeId, await colorForNode(nodeId));
    })
  );

  const lines = [];
  lines.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${CANVAS_SIZE}\" height=\"${CANVAS_SIZE}\" viewBox=\"0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}\">`
  );
  lines.push(`<rect width=\"${CANVAS_SIZE}\" height=\"${CANVAS_SIZE}\" fill=\"#000000\"/>`);

  for (const nodeId of nodeIds) {
    const index = nodeId - 1;
    const row = Math.floor(index / GRID_COLUMNS);
    const col = index % GRID_COLUMNS;
    const x = col * CELL_SIZE;
    const y = row * CELL_SIZE;
    const color = colors.get(nodeId) || "#808080";

    lines.push(
      `<rect x=\"${x}\" y=\"${y}\" width=\"${CELL_SIZE}\" height=\"${CELL_SIZE}\" fill=\"${color}\"/>`
    );
  }
  lines.push("</svg>");

  return lines.join("");
}

async function finalArtworkSvgForCurrentTerminal() {
  if (!terminalSnapshot) {
    throw new Error("Terminal snapshot not available");
  }

  if (finalSvgCache.seedHash === terminalSnapshot.seedHash && finalSvgCache.svg) {
    return finalSvgCache.svg;
  }

  const svg = await buildFinalArtworkSvg(terminalSnapshot);
  finalSvgCache = {
    seedHash: terminalSnapshot.seedHash,
    svg
  };
  return svg;
}

async function readAuctionState(walletAddress) {
  if (!auction) {
    return {
      configured: false
    };
  }

  const [auctionActive, finalized, auctionEnd, auctionRoundId, snapshotHash, highestBidder, highestBid, owner] =
    await Promise.all([
      auction.auctionActive(),
      auction.finalized(),
      auction.auctionEnd(),
      auction.auctionRoundId(),
      auction.snapshotHash(),
      auction.highestBidder(),
      auction.highestBid(),
      auction.owner()
    ]);

  let pendingReturns = 0n;
  let hasBidInRound = false;

  if (walletAddress) {
    pendingReturns = await auction.pendingReturns(walletAddress);
    hasBidInRound = await auction.hasBidInRound(auctionRoundId, walletAddress);
  }

  let finalArtworkTokenId = 0n;
  if (finalArtwork) {
    try {
      finalArtworkTokenId = await finalArtwork.tokenIdByRound(auctionRoundId);
    } catch {
      finalArtworkTokenId = 0n;
    }
  }

  return {
    configured: true,
    auctionAddress: config.finalAuction.address,
    finalized: Boolean(finalized),
    auctionActive: Boolean(auctionActive),
    auctionEnd: Number(auctionEnd),
    auctionRoundId: Number(auctionRoundId),
    snapshotHash,
    highestBidder,
    highestBidWei: highestBid.toString(),
    highestBidEth: ethers.formatEther(highestBid),
    owner,
    pendingReturnsWei: pendingReturns.toString(),
    pendingReturnsEth: ethers.formatEther(pendingReturns),
    hasBidInRound: Boolean(hasBidInRound),
    finalArtworkTokenId: Number(finalArtworkTokenId)
  };
}

async function syncRoundState() {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const [totalSupply, roundId] = await Promise.all([
      readTotalSupply(),
      readRoundId()
    ]);
    const auctionFinalization = await readAuctionFinalizationState(roundId);

    const previousRoundId = chainState.roundId;
    chainState = { totalSupply, roundId };
    auctionRoundIdOnChain = auctionFinalization.auctionRoundId;
    auctionFinalized = auctionFinalization.finalizedForCurrentRound;

    const roundAdvanced = roundIdSupported && roundId > previousRoundId;
    if (roundAdvanced) {
      await refreshCarryShuffleSeed(roundId);
    } else if (!terminalSnapshot && roundId > 1 && carryShuffleSourceRound !== roundId - 1) {
      await refreshCarryShuffleSeed(roundId);
    }

    if (terminalSnapshot && roundIdSupported && roundId > previousRoundId) {
      clearOffchainRoundState();
      return;
    }

    if (!terminalFrozen) {
      const alive = buildLiveAlive();
      const activeCount = Object.keys(alive).length;
      if (totalSupply === MAX_NODES && activeCount === MAX_NODES) {
        const snapshot = await buildTerminalSnapshot(alive);
        if (snapshot) {
          terminalFrozen = true;
          frozenAlive = { ...alive };
          terminalSnapshot = snapshot;
          finalSvgCache = { seedHash: "", svg: "" };
        }
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

app.get("/terminal-snapshot", async (_req, res) => {
  try {
    await syncRoundState();

    res.json({
      terminal: terminalFrozen,
      totalSupply: chainState.totalSupply,
      roundId: chainState.roundId,
      snapshot: terminalSnapshot
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch terminal snapshot" });
  }
});

app.get("/auction-state", async (req, res) => {
  try {
    await syncRoundState();

    let wallet = "";
    if (typeof req.query.wallet === "string" && req.query.wallet.trim()) {
      wallet = ethers.getAddress(req.query.wallet.trim());
    }

    const state = await readAuctionState(wallet || "");

    res.json({
      ...state,
      totalSupply: chainState.totalSupply,
      roundId: chainState.roundId,
      terminal: terminalFrozen,
      auctionRoundId: auctionRoundIdOnChain,
      auctionFinalizedCurrentRound: auctionFinalized,
      terminalSeedHash: terminalSnapshot ? terminalSnapshot.seedHash : ethers.ZeroHash,
      shuffleSourceRound:
        terminalSnapshot && auctionFinalized
          ? terminalSnapshot.roundId
          : carryShuffleSourceRound,
      awaitingAuction: Boolean(terminalSnapshot) && !auctionFinalized,
      shuffleSeed: effectiveShuffleSeed(),
      shuffleReady: shuffleReady()
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to fetch auction state" });
  }
});

app.get("/final-artwork-svg", async (_req, res) => {
  try {
    await syncRoundState();
    if (!terminalSnapshot) {
      res.status(409).json({ error: "Terminal snapshot not available" });
      return;
    }

    const svg = await finalArtworkSvgForCurrentTerminal();

    res.json({
      roundId: terminalSnapshot.roundId,
      seedHash: terminalSnapshot.seedHash,
      svg
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to build final artwork SVG" });
  }
});

app.get("/final-artwork-preview.svg", async (_req, res) => {
  try {
    await syncRoundState();
    if (!terminalSnapshot) {
      res.status(409).send("Terminal snapshot not available");
      return;
    }

    const svg = await finalArtworkSvgForCurrentTerminal();
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.send(svg);
  } catch (error) {
    res.status(500).send(error.message || "Failed to build preview SVG");
  }
});

const server = app.listen(PORT, () => {
  console.log("v8 running -> http://localhost:" + PORT);
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
        recordActivation(verified);
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
