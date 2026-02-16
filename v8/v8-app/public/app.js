const ethers = window.ethers;

const MAX_NODES = 100;
const DEFAULT_CHAIN_ID = 11155111;
const READ_RPC_FALLBACK = "https://ethereum-sepolia-rpc.publicnode.com";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

let config = null;

let readProvider = null;
let readNodesContract = null;

let provider = null;
let signer = null;
let writeNodesContract = null;

let wallet = null;
let ownedNode = 0;
let walletHasMinted = false;
let isSeeding = false;

let seedWs = null;
let viewWs = null;

let latestAlive = {};
let totalSupply = 0;
let terminal = false;
let snapshot = null;
let shuffleSeed = "";
let shuffleSourceRound = 0;
let awaitingAuction = false;
let auctionRoundId = 0;
let auctionFinalizedCurrentRound = false;
let shuffleReady = false;

let svgSyncEpoch = 0;
let layoutCacheKey = "";
let layoutCache = null;

const nodeSvgCache = new Map();
const nodeImageCache = new Map();
const pendingNodeFetch = new Map();

const connectBtn = document.getElementById("connect");
const mintBtn = document.getElementById("mint");
const statusEl = document.getElementById("status");
const metricsEl = document.getElementById("metrics");
const walletsEl = document.getElementById("wallets");
const seederEl = document.getElementById("seeder");
const gridEl = document.getElementById("grid");
const finalProgressTextEl = document.getElementById("final-progress-text");
const finalProgressFillEl = document.getElementById("final-progress-fill");
const simPanelEl = document.getElementById("sim-panel");
const simMintedEl = document.getElementById("sim-minted");
const simSeededEl = document.getElementById("sim-seeded");
const simApplyEl = document.getElementById("sim-apply");
const simAllEl = document.getElementById("sim-all");
const simClearEl = document.getElementById("sim-clear");

const cells = [];
const testingMode = new URLSearchParams(window.location.search).get("testingMode") === "1";

function wsUrl() {
  const scheme = location.protocol === "https:" ? "wss://" : "ws://";
  return scheme + location.host;
}

function shortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function setStatus(text) {
  statusEl.innerText = text;
}

function seedMessage(nonce) {
  return `P2P v8 seeding authorization\nNonce: ${nonce}`;
}

function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function parseTokenURI(tokenURI) {
  const jsonPrefix = "data:application/json;base64,";
  const imagePrefix = "data:image/svg+xml;base64,";

  if (!tokenURI.startsWith(jsonPrefix)) {
    throw new Error("Invalid tokenURI format");
  }

  const metadataText = base64ToUtf8(tokenURI.slice(jsonPrefix.length));
  const metadata = JSON.parse(metadataText);

  if (typeof metadata.image !== "string" || !metadata.image.startsWith(imagePrefix)) {
    throw new Error("Invalid image format");
  }

  return base64ToUtf8(metadata.image.slice(imagePrefix.length));
}

function hexByte(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function deterministicColor(nodeId) {
  const packed = ethers.solidityPacked(["uint256"], [BigInt(nodeId)]);
  const hash = ethers.getBytes(ethers.keccak256(packed));

  const r = Math.floor(hash[0] / 2) + 64;
  const g = Math.floor(hash[1] / 2) + 64;
  const b = Math.floor(hash[2] / 2) + 64;

  return "#" + hexByte(r) + hexByte(g) + hexByte(b);
}

function localSvgForNode(nodeId) {
  const color = deterministicColor(nodeId);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    `<rect width="120" height="120" fill="${color}"/>` +
    "</svg>"
  );
}

function cacheLocalSvg(nodeId) {
  if (nodeImageCache.has(nodeId) && nodeSvgCache.has(nodeId)) {
    return nodeSvgCache.get(nodeId);
  }

  const svgText = localSvgForNode(nodeId);
  nodeSvgCache.set(nodeId, svgText);
  nodeImageCache.set(nodeId, "data:image/svg+xml;base64," + utf8ToBase64(svgText));
  return svgText;
}

function createGrid() {
  for (let slot = 0; slot < MAX_NODES; slot += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.slot = String(slot);

    const img = document.createElement("img");
    img.alt = `Slot ${slot + 1}`;

    cell.appendChild(img);
    gridEl.appendChild(cell);
    cells.push({ cell, img });
  }
}

function clearCell(entry) {
  entry.img.removeAttribute("src");
  entry.img.style.display = "none";
  entry.cell.classList.remove("seeded");
  entry.cell.removeAttribute("title");
}

function normalizeAlive(rawAlive) {
  const out = {};
  if (!rawAlive || typeof rawAlive !== "object") {
    return out;
  }

  for (const [key, value] of Object.entries(rawAlive)) {
    const node = Number(key);
    if (
      Number.isInteger(node) &&
      node >= 1 &&
      node <= MAX_NODES &&
      typeof value === "string" &&
      value.length > 0
    ) {
      out[node] = value;
    }
  }

  return out;
}

function normalizeSnapshot(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    return null;
  }

  const blockNumber = Number(rawSnapshot.blockNumber);
  const timestamp = Number(rawSnapshot.timestamp);
  const seedHash =
    typeof rawSnapshot.seedHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(rawSnapshot.seedHash)
      ? rawSnapshot.seedHash
      : null;

  const nodeIds = Array.isArray(rawSnapshot.nodeIds)
    ? rawSnapshot.nodeIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_NODES)
        .sort((a, b) => a - b)
    : [];

  if (!Number.isInteger(blockNumber) || !Number.isInteger(timestamp) || !seedHash) {
    return null;
  }

  return {
    blockNumber,
    timestamp,
    nodeIds,
    seedHash
  };
}

function normalizeShuffleSeed(rawSeed) {
  if (typeof rawSeed !== "string") {
    return "";
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(rawSeed)) {
    return "";
  }

  if (rawSeed.toLowerCase() === ZERO_HASH) {
    return "";
  }

  return rawSeed;
}

async function fetchNodeSvgFromChain(nodeId) {
  if (testingMode) {
    return cacheLocalSvg(nodeId);
  }

  try {
    const tokenURI = await readNodesContract.tokenURI(nodeId);
    const svgText = parseTokenURI(tokenURI);
    const dataUri = "data:image/svg+xml;base64," + utf8ToBase64(svgText);
    nodeSvgCache.set(nodeId, svgText);
    nodeImageCache.set(nodeId, dataUri);
    return svgText;
  } catch {
    nodeSvgCache.delete(nodeId);
    nodeImageCache.delete(nodeId);
    return null;
  }
}

function ensureNodeSvg(nodeId) {
  if (testingMode) {
    return Promise.resolve(cacheLocalSvg(nodeId));
  }

  if (nodeSvgCache.has(nodeId)) {
    return Promise.resolve(nodeSvgCache.get(nodeId));
  }

  if (pendingNodeFetch.has(nodeId)) {
    return pendingNodeFetch.get(nodeId);
  }

  const promise = fetchNodeSvgFromChain(nodeId).finally(() => {
    pendingNodeFetch.delete(nodeId);
  });
  pendingNodeFetch.set(nodeId, promise);
  return promise;
}

function buildShufflePositions(seedHash) {
  const positions = Array.from({ length: MAX_NODES }, (_, i) => i);
  let entropy = seedHash;

  for (let i = positions.length - 1; i > 0; i -= 1) {
    entropy = ethers.keccak256(entropy);
    const pick = Number(BigInt(entropy) % BigInt(i + 1));
    const temp = positions[i];
    positions[i] = positions[pick];
    positions[pick] = temp;
  }

  return positions;
}

function invalidateLayoutCache() {
  layoutCacheKey = "";
  layoutCache = null;
}

function currentLayout() {
  const seedPart = shuffleSeed || "natural";
  const key = `${totalSupply}|${seedPart}`;

  if (layoutCache && layoutCacheKey === key) {
    return layoutCache;
  }

  const cellToNode = new Array(MAX_NODES).fill(0);
  const nodeToCell = new Map();
  const cap = Math.max(0, Math.min(totalSupply, MAX_NODES));

  if (shuffleSeed) {
    const positions = buildShufflePositions(shuffleSeed);
    for (let nodeId = 1; nodeId <= cap; nodeId += 1) {
      const cellIndex = positions[nodeId - 1];
      cellToNode[cellIndex] = nodeId;
      nodeToCell.set(nodeId, cellIndex);
    }
  } else {
    for (let nodeId = 1; nodeId <= cap; nodeId += 1) {
      const cellIndex = nodeId - 1;
      cellToNode[cellIndex] = nodeId;
      nodeToCell.set(nodeId, cellIndex);
    }
  }

  layoutCache = { cellToNode, nodeToCell };
  layoutCacheKey = key;
  return layoutCache;
}

function renderCanvas() {
  const { cellToNode } = currentLayout();

  for (let i = 0; i < MAX_NODES; i += 1) {
    const entry = cells[i];
    const nodeId = cellToNode[i];

    if (!nodeId) {
      clearCell(entry);
      continue;
    }

    const walletAddress = latestAlive[nodeId];
    if (!walletAddress) {
      clearCell(entry);
      continue;
    }

    const dataUri = nodeImageCache.get(nodeId);
    if (!dataUri) {
      clearCell(entry);
      continue;
    }

    if (entry.img.src !== dataUri) {
      entry.img.src = dataUri;
    }
    entry.img.style.display = "block";
    entry.cell.title = `${nodeId} - ${walletAddress}`;
  }
}

async function syncMintedSvgsAndRender() {
  const epoch = ++svgSyncEpoch;
  const tasks = [];

  for (const key of Object.keys(latestAlive)) {
    const nodeId = Number(key);
    if (!Number.isInteger(nodeId) || nodeId < 1 || nodeId > totalSupply) {
      continue;
    }
    tasks.push(ensureNodeSvg(nodeId));
  }

  await Promise.allSettled(tasks);
  if (epoch !== svgSyncEpoch) return;
  renderCanvas();
}

function hasMissingSeededImages() {
  for (const key of Object.keys(latestAlive)) {
    const nodeId = Number(key);
    if (Number.isInteger(nodeId) && nodeId >= 1 && nodeId <= totalSupply && !nodeImageCache.has(nodeId)) {
      return true;
    }
  }
  return false;
}

function baseRoundStatus() {
  if (terminal) {
    if (shuffleReady) {
      return "Terminal locked. Auction finalized. Claim + reset to start next shuffled round.";
    }
    return "Terminal locked. Snapshot captured. Seeding frozen until auction finalizes.";
  }

  if (totalSupply >= MAX_NODES) {
    if (shuffleReady) {
      return `All 100 nodes minted. Round is live on shuffled layout (from round ${shuffleSourceRound || "?"}).`;
    }
    return "All 100 nodes minted. Round is live.";
  }

  return "Mint phase open.";
}

function updateFinalArtworkProgress(seededCount) {
  const seeded = Math.max(0, Math.min(seededCount, MAX_NODES));
  const seededRemaining = MAX_NODES - seeded;
  const minted = Math.max(0, Math.min(totalSupply, MAX_NODES));
  const mintRemaining = MAX_NODES - minted;
  const percent = (seeded / MAX_NODES) * 100;

  if (finalProgressFillEl) {
    finalProgressFillEl.style.width = `${percent}%`;
  }

  if (finalProgressTextEl) {
    finalProgressTextEl.innerText =
      `Seeding for final artwork: ${seeded} / ${MAX_NODES} | Remaining to final artwork: ${seededRemaining} | Minted remaining: ${mintRemaining}`;
  }
}

function updateMetrics() {
  const activeCount = Object.keys(latestAlive).length;
  const mappingLabel = shuffleReady
    ? `shuffled (src round ${shuffleSourceRound || "?"})`
    : "natural";
  metricsEl.innerText =
    `minted: ${totalSupply} / ${MAX_NODES} | seeding: ${activeCount} / ${MAX_NODES} | mapping: ${mappingLabel} | auctionRound: ${auctionRoundId || "-"} | finalized(current): ${auctionFinalizedCurrentRound ? "yes" : "no"}`;
  updateFinalArtworkProgress(activeCount);

  if (terminal && snapshot) {
    walletsEl.innerText =
      `snapshot -> block ${snapshot.blockNumber} | ts ${snapshot.timestamp} | seed ${snapshot.seedHash}` +
      (awaitingAuction ? " | next: finalize auction, claim, reset" : "");
    return;
  }

  if (testingMode) {
    const seededNodes = Object.keys(latestAlive)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value))
      .sort((a, b) => a - b);
    walletsEl.innerText = seededNodes.length
      ? "seeded nodes: " + seededNodes.join(", ")
      : "seeded nodes: none";
    return;
  }

  const activeWallets = Object.values(latestAlive);
  walletsEl.innerText = activeWallets.length
    ? "active wallets: " + activeWallets.join(", ")
    : "";
}

function refreshOwnerControls() {
  if (testingMode) {
    mintBtn.style.display = "none";
    seederEl.style.display = "none";
    seederEl.innerHTML = "";
    return;
  }

  const canMint =
    wallet &&
    ownedNode === 0 &&
    !walletHasMinted &&
    !terminal &&
    totalSupply < MAX_NODES;

  mintBtn.style.display = canMint ? "block" : "none";
  mintBtn.disabled = false;
  mintBtn.innerText = "Mint Pixel";

  const showSeeder = wallet && ownedNode > 0 && !terminal;
  seederEl.style.display = showSeeder ? "flex" : "none";

  if (!showSeeder) {
    seederEl.innerHTML = "";
    if (terminal && seedWs) {
      seedWs.close();
      seedWs = null;
    }
    isSeeding = false;
    return;
  }

  if (seederEl.childElementCount > 0) {
    return;
  }

  const start = document.createElement("button");
  start.innerText = "Start seeding";
  start.onclick = () => startSeeding();

  const stop = document.createElement("button");
  stop.innerText = "Stop seeding";
  stop.onclick = () => stopSeeding();

  seederEl.append(start, stop);
}

function updateOwnerStatus() {
  const roundMessage = baseRoundStatus();

  if (testingMode) {
    setStatus(`${roundMessage} Testing mode active (?testingMode=1). SVG is visible only while seeded.`);
    return;
  }

  if (!wallet) {
    setStatus(`${roundMessage} Connect wallet to participate.`);
    return;
  }

  if (ownedNode === 0) {
    if (walletHasMinted) {
      setStatus(`${roundMessage} Wallet already used its one mint.`);
      return;
    }

    if (terminal || totalSupply >= MAX_NODES) {
      setStatus(`${roundMessage} Mint is closed.`);
      return;
    }

    setStatus(`${roundMessage} Connected. Mint to participate.`);
    return;
  }

  if (terminal) {
    setStatus(`${roundMessage} You are Node ${ownedNode}.`);
    return;
  }

  setStatus(
    isSeeding
      ? `${roundMessage} You are Node ${ownedNode}. Seeding is active.`
      : `${roundMessage} You are Node ${ownedNode}. Seeding is off.`
  );
}

function resetWalletUi() {
  wallet = null;
  ownedNode = 0;
  walletHasMinted = false;
  isSeeding = false;
  provider = null;
  signer = null;
  writeNodesContract = null;

  if (seedWs) {
    seedWs.close();
    seedWs = null;
  }

  connectBtn.innerText = "Connect Wallet";
  seederEl.style.display = "none";
  seederEl.innerHTML = "";
  mintBtn.style.display = "none";
  mintBtn.disabled = false;
  mintBtn.innerText = "Mint Pixel";
  updateOwnerStatus();
}

async function ensureChain() {
  const expectedChainId = Number(config.chainId || DEFAULT_CHAIN_ID);
  const network = await provider.getNetwork();
  if (Number(network.chainId) === expectedChainId) {
    return;
  }

  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x" + expectedChainId.toString(16) }]
  });
}

async function refreshOwnership() {
  if (!wallet || !writeNodesContract) return;

  ownedNode = Number(await writeNodesContract.nodeOf(wallet));
  try {
    walletHasMinted = Boolean(await writeNodesContract.hasMinted(wallet));
  } catch {
    walletHasMinted = ownedNode > 0;
  }
  refreshOwnerControls();
  updateOwnerStatus();
}

async function connectWallet() {
  if (testingMode) return;

  if (!window.ethereum) {
    alert("MetaMask not detected");
    return;
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  await ensureChain();

  signer = await provider.getSigner();
  wallet = await signer.getAddress();

  writeNodesContract = new ethers.Contract(
    config.nodes.address,
    config.nodes.abi,
    signer
  );

  connectBtn.innerText = shortAddress(wallet);
  setStatus("Checking ownership...");
  await refreshOwnership();
}

async function mintNode() {
  if (testingMode) return;
  if (!writeNodesContract) return;

  mintBtn.disabled = true;
  mintBtn.innerText = "Minting...";

  try {
    const tx = await writeNodesContract.mint();
    setStatus("Waiting for mint confirmation...");
    await tx.wait();

    await Promise.all([refreshOwnership(), fetchRoundState()]);
    await syncMintedSvgsAndRender();
  } catch (error) {
    setStatus(error.shortMessage || error.message || "Mint failed");
  } finally {
    mintBtn.disabled = false;
    mintBtn.innerText = "Mint Pixel";
    refreshOwnerControls();
    updateOwnerStatus();
  }
}

async function authorizeSeeding(nonce) {
  if (!seedWs || seedWs.readyState !== WebSocket.OPEN || !signer || !wallet || ownedNode === 0) {
    return;
  }

  setStatus(`Node ${ownedNode}: sign seeding authorization`);
  const signature = await signer.signMessage(seedMessage(nonce));

  seedWs.send(
    JSON.stringify({
      type: "seed-auth",
      nonce,
      wallet,
      node: ownedNode,
      signature
    })
  );
}

function startSeeding() {
  if (testingMode) return;
  if (!wallet || ownedNode === 0 || seedWs || terminal) {
    return;
  }

  seedWs = new WebSocket(wsUrl());

  seedWs.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "challenge") {
      authorizeSeeding(data.nonce).catch((error) => {
        setStatus(error.shortMessage || error.message || "Seeding authorization failed");
        stopSeeding();
      });
      return;
    }

    if (data.type === "seed-ack") {
      isSeeding = true;
      updateOwnerStatus();
      return;
    }

    if (data.type === "alive") {
      applyRoundPayload(data).catch(() => {});
      return;
    }

    if (data.type === "error") {
      setStatus(data.message || "Seeding failed");
      stopSeeding();
    }
  };

  seedWs.onclose = () => {
    seedWs = null;
    if (isSeeding) {
      isSeeding = false;
      updateOwnerStatus();
    }
  };
}

function stopSeeding() {
  if (testingMode) return;
  if (seedWs && seedWs.readyState === WebSocket.OPEN) {
    seedWs.send(JSON.stringify({ type: "seed-stop" }));
  }

  if (seedWs) {
    seedWs.close();
    seedWs = null;
  }

  isSeeding = false;
  updateOwnerStatus();
}

async function applyRoundPayload(payload) {
  const alive = normalizeAlive(payload.alive);

  const nextSupply = Math.max(0, Math.min(Number(payload.totalSupply || 0), MAX_NODES));
  const nextTerminal = Boolean(payload.terminal);
  const nextSnapshot = normalizeSnapshot(payload.snapshot);
  const nextShuffleSeed = normalizeShuffleSeed(payload.shuffleSeed);
  const nextAuctionRoundId = Number(payload.auctionRoundId || 0);
  const nextAuctionFinalizedCurrentRound = Boolean(payload.auctionFinalizedCurrentRound);
  const nextShuffleSourceRound = Number.isInteger(Number(payload.shuffleSourceRound))
    ? Number(payload.shuffleSourceRound)
    : 0;
  const nextAwaitingAuction = Boolean(payload.awaitingAuction);
  const nextShuffleReady = Boolean(nextShuffleSeed);

  const layoutChanged =
    nextSupply !== totalSupply ||
    nextShuffleSeed !== shuffleSeed ||
    nextAuctionRoundId !== auctionRoundId ||
    nextAuctionFinalizedCurrentRound !== auctionFinalizedCurrentRound ||
    nextShuffleSourceRound !== shuffleSourceRound ||
    nextShuffleReady !== shuffleReady ||
    (nextSnapshot ? nextSnapshot.seedHash : "") !== (snapshot ? snapshot.seedHash : "");

  totalSupply = nextSupply;
  terminal = nextTerminal;
  snapshot = nextSnapshot;
  shuffleSeed = nextShuffleSeed;
  auctionRoundId = nextAuctionRoundId;
  auctionFinalizedCurrentRound = nextAuctionFinalizedCurrentRound;
  shuffleSourceRound = nextShuffleSourceRound;
  awaitingAuction = nextAwaitingAuction;
  shuffleReady = nextShuffleReady;
  latestAlive = alive;

  if (layoutChanged || hasMissingSeededImages()) {
    invalidateLayoutCache();
    await syncMintedSvgsAndRender();
  } else {
    renderCanvas();
  }

  refreshOwnerControls();
  updateMetrics();
  updateOwnerStatus();
}

function clampCount(value, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Math.floor(parsed), max));
}

function simulatedWallet(nodeId) {
  return "0x" + nodeId.toString(16).padStart(40, "0");
}

function buildSimAlive(seededCount) {
  const alive = {};
  for (let nodeId = 1; nodeId <= seededCount; nodeId += 1) {
    alive[nodeId] = simulatedWallet(nodeId);
  }
  return alive;
}

function buildSimSnapshot(mintedCount, seededCount) {
  const nodeIds = [];
  for (let nodeId = 1; nodeId <= seededCount; nodeId += 1) {
    nodeIds.push(nodeId);
  }

  return {
    blockNumber: 0,
    timestamp: Math.floor(Date.now() / 1000),
    nodeIds,
    seedHash: ethers.keccak256(
      ethers.toUtf8Bytes(`testing-mode:${mintedCount}:${seededCount}`)
    )
  };
}

async function applySimulationState(mintedInput, seededInput) {
  const minted = clampCount(mintedInput, MAX_NODES);
  const seeded = clampCount(seededInput, minted);

  if (simMintedEl) simMintedEl.value = String(minted);
  if (simSeededEl) simSeededEl.value = String(seeded);

  const simTerminal = minted === MAX_NODES && seeded === MAX_NODES;
  const simSnapshot = simTerminal ? buildSimSnapshot(minted, seeded) : null;
  const simShuffleSeed = simSnapshot ? simSnapshot.seedHash : "";

  const payload = {
    alive: buildSimAlive(seeded),
    totalSupply: minted,
    auctionRoundId: 0,
    auctionFinalizedCurrentRound: false,
    terminal: simTerminal,
    snapshot: simSnapshot,
    shuffleSeed: simShuffleSeed,
    shuffleSourceRound: simShuffleSeed ? 1 : 0,
    awaitingAuction: simTerminal && !simShuffleSeed,
    shuffleReady: Boolean(simShuffleSeed)
  };

  await applyRoundPayload(payload);
}

function setupSimulationUi() {
  if (!simPanelEl) return;
  simPanelEl.style.display = "flex";

  simApplyEl?.addEventListener("click", () => {
    applySimulationState(simMintedEl?.value ?? 0, simSeededEl?.value ?? 0).catch(() => {});
  });

  simAllEl?.addEventListener("click", () => {
    applySimulationState(MAX_NODES, MAX_NODES).catch(() => {});
  });

  simClearEl?.addEventListener("click", () => {
    applySimulationState(simMintedEl?.value ?? MAX_NODES, 0).catch(() => {});
  });
}

async function initTestingMode() {
  connectBtn.style.display = "none";
  mintBtn.style.display = "none";
  seederEl.style.display = "none";
  seederEl.innerHTML = "";
  setupSimulationUi();
  await applySimulationState(MAX_NODES, 0);
}

function connectViewerSocket() {
  viewWs = new WebSocket(wsUrl());

  viewWs.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "alive") {
      applyRoundPayload(data).catch(() => {});
    }
  };

  viewWs.onclose = () => {
    viewWs = null;
    latestAlive = {};
    updateMetrics();
    renderCanvas();
    setTimeout(connectViewerSocket, 1500);
  };
}

async function loadConfig() {
  const response = await fetch("/contract-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load contract config");
  }

  const loaded = await response.json();
  if (!loaded.nodes || !loaded.nodes.address) {
    throw new Error("Set nodes.address in contract-config.json");
  }
  if (!Array.isArray(loaded.nodes.abi)) {
    throw new Error("Missing nodes.abi in contract-config.json");
  }

  return loaded;
}

async function fetchRoundState() {
  const response = await fetch("/round-state", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch round state");
  }
  const state = await response.json();
  return applyRoundPayload(state);
}

async function init() {
  createGrid();
  updateMetrics();

  if (testingMode) {
    await initTestingMode();
    return;
  }

  config = await loadConfig();
  const readRpc = config.readRpc || READ_RPC_FALLBACK;
  const chainId = Number(config.chainId || DEFAULT_CHAIN_ID);

  readProvider = new ethers.JsonRpcProvider(readRpc, chainId);
  readNodesContract = new ethers.Contract(
    config.nodes.address,
    config.nodes.abi,
    readProvider
  );

  await fetchRoundState();
  connectViewerSocket();
  setInterval(() => {
    fetchRoundState().catch(() => {});
  }, 12000);
}

connectBtn.onclick = () => {
  connectWallet().catch((error) => {
    setStatus(error.shortMessage || error.message || "Wallet connect failed");
  });
};

mintBtn.onclick = () => {
  mintNode();
};

window.ethereum?.on("accountsChanged", () => {
  resetWalletUi();
});

window.ethereum?.on("chainChanged", () => {
  window.location.reload();
});

init().catch((error) => {
  setStatus(error.message || "Failed to initialize app");
});
