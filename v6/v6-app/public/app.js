const ethers = window.ethers;

const MAX_NODES = 100;
const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_CHAIN_HEX = "0xaa36a7";
const READ_RPC_FALLBACK = "https://ethereum-sepolia-rpc.publicnode.com";

let config = null;
let readProvider = null;
let readContract = null;

let provider = null;
let signer = null;
let writeContract = null;

let wallet = null;
let ownedNode = 0;
let isSeeding = false;

let seedWs = null;
let viewWs = null;

let latestAlive = {};
let renderEpoch = 0;

const nodeSvgCache = new Map();
const pendingNodeFetch = new Map();

const connectBtn = document.getElementById("connect");
const mintBtn = document.getElementById("mint");
const statusEl = document.getElementById("status");
const metricsEl = document.getElementById("metrics");
const walletsEl = document.getElementById("wallets");
const seederEl = document.getElementById("seeder");
const gridEl = document.getElementById("grid");

const cells = [];

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
  return `P2P v6 seeding authorization\nNonce: ${nonce}`;
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

function createGrid() {
  for (let node = 1; node <= MAX_NODES; node += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.node = String(node);

    const img = document.createElement("img");
    img.alt = `Node ${node}`;

    cell.appendChild(img);
    gridEl.appendChild(cell);
    cells.push({ cell, img });
  }
}

function clearNodeCell(nodeId) {
  const entry = cells[nodeId - 1];
  if (!entry) return;

  entry.img.removeAttribute("src");
  entry.img.style.display = "none";
}

function renderNodeSvg(nodeId, svgText) {
  const entry = cells[nodeId - 1];
  if (!entry) return;

  entry.img.src = "data:image/svg+xml;base64," + utf8ToBase64(svgText);
  entry.img.style.display = "block";
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

async function fetchNodeSvgFromChain(nodeId) {
  try {
    const tokenURI = await readContract.tokenURI(nodeId);
    const svgText = parseTokenURI(tokenURI);
    nodeSvgCache.set(nodeId, svgText);
    return svgText;
  } catch {
    nodeSvgCache.delete(nodeId);
    return null;
  }
}

function ensureNodeSvg(nodeId) {
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

async function applySeedingState(rawAlive) {
  const alive = normalizeAlive(rawAlive);
  latestAlive = alive;
  const epoch = ++renderEpoch;

  const activeWallets = Object.values(alive);
  metricsEl.innerText = `seeding: ${activeWallets.length} / ${MAX_NODES}`;
  walletsEl.innerText = activeWallets.length
    ? "active wallets: " + activeWallets.join(", ")
    : "";

  for (let node = 1; node <= MAX_NODES; node += 1) {
    if (!alive[node]) {
      clearNodeCell(node);
    }
  }

  const tasks = [];
  for (const key of Object.keys(alive)) {
    const node = Number(key);
    const cachedSvg = nodeSvgCache.get(node);
    if (cachedSvg) {
      renderNodeSvg(node, cachedSvg);
      continue;
    }

    tasks.push(
      ensureNodeSvg(node).then((svgText) => {
        if (epoch !== renderEpoch || !latestAlive[node]) {
          return;
        }

        if (svgText) {
          renderNodeSvg(node, svgText);
        } else {
          clearNodeCell(node);
        }
      })
    );
  }

  await Promise.allSettled(tasks);
}

function resetWalletUi() {
  wallet = null;
  ownedNode = 0;
  isSeeding = false;
  provider = null;
  signer = null;
  writeContract = null;

  if (seedWs) {
    seedWs.close();
    seedWs = null;
  }

  connectBtn.innerText = "Connect";
  mintBtn.style.display = "none";
  mintBtn.disabled = false;
  mintBtn.innerText = "Mint Pixel";

  seederEl.style.display = "none";
  seederEl.innerHTML = "";

  setStatus("Seeding-only render active. Connect wallet to participate.");
}

function updateOwnerStatus() {
  if (!wallet) return;
  if (ownedNode === 0) {
    setStatus("Connected. Mint to participate.");
    return;
  }

  setStatus(
    isSeeding
      ? `You are Node ${ownedNode}. Seeding is active.`
      : `You are Node ${ownedNode}. Seeding is off.`
  );
}

function renderSeederControls() {
  seederEl.innerHTML = "";
  seederEl.style.display = "flex";

  const start = document.createElement("button");
  start.innerText = "Start seeding";
  start.onclick = () => startSeeding();

  const stop = document.createElement("button");
  stop.innerText = "Stop seeding";
  stop.onclick = () => stopSeeding();

  seederEl.append(start, stop);
}

async function ensureSepolia() {
  const network = await provider.getNetwork();
  if (Number(network.chainId) === SEPOLIA_CHAIN_ID) {
    return;
  }

  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: SEPOLIA_CHAIN_HEX }],
  });
}

async function connectWallet() {
  if (!window.ethereum) {
    alert("MetaMask not detected");
    return;
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  await ensureSepolia();

  signer = await provider.getSigner();
  wallet = await signer.getAddress();
  writeContract = new ethers.Contract(config.address, config.abi, signer);

  connectBtn.innerText = shortAddress(wallet);

  setStatus("Checking ownership...");
  ownedNode = Number(await writeContract.nodeOf(wallet));

  if (ownedNode === 0) {
    mintBtn.style.display = "block";
    updateOwnerStatus();
    return;
  }

  mintBtn.style.display = "none";
  renderSeederControls();
  updateOwnerStatus();
}

async function mintNode() {
  if (!writeContract) return;

  mintBtn.disabled = true;
  mintBtn.innerText = "Minting...";

  try {
    const tx = await writeContract.mint();
    setStatus("Waiting for mint confirmation...");
    await tx.wait();

    ownedNode = Number(await writeContract.nodeOf(wallet));
    await ensureNodeSvg(ownedNode);

    mintBtn.style.display = "none";
    mintBtn.disabled = false;
    mintBtn.innerText = "Mint Pixel";

    renderSeederControls();
    updateOwnerStatus();
  } catch (error) {
    mintBtn.disabled = false;
    mintBtn.innerText = "Mint Pixel";
    setStatus(error.shortMessage || error.message || "Mint failed");
  }
}

async function authorizeSeeding(nonce) {
  if (!seedWs || seedWs.readyState !== WebSocket.OPEN || !signer || !wallet) {
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
      signature,
    })
  );
}

function startSeeding() {
  if (!wallet || ownedNode === 0 || seedWs) {
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
      applySeedingState(data.alive).catch(() => {});
    }
  };

  viewWs.onclose = () => {
    applySeedingState({}).catch(() => {});
    setTimeout(connectViewerSocket, 1500);
  };
}

async function loadConfig() {
  const response = await fetch("/contract-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load contract config");
  }
  return response.json();
}

async function init() {
  createGrid();
  await applySeedingState({});

  config = await loadConfig();
  const readRpc = config.readRpc || READ_RPC_FALLBACK;
  readProvider = new ethers.JsonRpcProvider(readRpc, config.chainId || SEPOLIA_CHAIN_ID);
  readContract = new ethers.Contract(config.address, config.abi, readProvider);

  setStatus("Seeding-only render active. Connect wallet.");
  connectViewerSocket();
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
