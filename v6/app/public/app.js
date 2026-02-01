const ethers = window.ethers;

/* =====================
   CONFIG
===================== */

const CONTRACT = "0x00934412783A31d5ed1E5eeb48BC99c78621C9fB";
const ABI = [
  "function mint() public",
  "function nodeOf(address) view returns (uint256)",
  "function tokenURI(uint256) view returns (string)"
];

/* =====================
   STATE
===================== */

let provider, signer, contract;
let wallet = null;
let ownedNode = 0;
let seedWs = null;
let isSeeding = false;
let nodeLocked = false;

/* =====================
   ELEMENTS
===================== */

const connectBtn = document.getElementById("connect");
const mintBtn = document.getElementById("mint");
const statusEl = document.getElementById("status");
const metricsEl = document.getElementById("metrics");
const walletsEl = document.getElementById("wallets");
const seederEl = document.getElementById("seeder");

/* =====================
   GRID
===================== */

const grid = document.getElementById("grid");
const cells = [];

for (let i = 0; i < 100; i++) {
  const c = document.createElement("div");
  c.className = "cell";
  grid.appendChild(c);
  cells.push(c);
}

/* =====================
   HELPERS
===================== */

function decodeSVG(uri) {
  return atob(uri.split(",")[1]);
}

function renderNode(node, svg) {
  cells[node - 1].innerHTML = svg;
}

/* =====================
   RESET
===================== */

function resetUI() {
  wallet = null;
  ownedNode = 0;
  isSeeding = false;
  nodeLocked = false;

  if (seedWs) {
    seedWs.close();
    seedWs = null;
  }

  connectBtn.innerText = "Connect";
  mintBtn.style.display = "none";
  seederEl.innerHTML = "";
  metricsEl.innerText = "";
  walletsEl.innerText = "";
  statusEl.innerText = "Connect wallet to participate";

  cells.forEach(c => (c.innerHTML = "", c.style.background = "#111"));
}

/* =====================
   CONNECT WALLET
===================== */

connectBtn.onclick = async () => {
  if (!window.ethereum) {
    alert("MetaMask not detected");
    return;
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  wallet = await signer.getAddress();
  contract = new ethers.Contract(CONTRACT, ABI, signer);

  connectBtn.innerText =
    wallet.slice(0, 6) + "..." + wallet.slice(-4);

  await checkOwnership();
};

if (window.ethereum) {
  window.ethereum.on("accountsChanged", resetUI);
}

/* =====================
   OWNERSHIP
===================== */

async function checkOwnership() {
  statusEl.innerText = "Checking ownership…";

  ownedNode = Number(await contract.nodeOf(wallet));

  if (ownedNode === 0) {
    mintBtn.style.display = "block";
    statusEl.innerText = "Mint to participate";
  } else {
    mintBtn.style.display = "none";
    await loadNode();
    renderSeeder();
  }
}

/* =====================
   MINT
===================== */

mintBtn.onclick = async () => {
  mintBtn.innerText = "Minting…";
  mintBtn.disabled = true;

  const tx = await contract.mint();
  await tx.wait();

  ownedNode = Number(await contract.nodeOf(wallet));
  mintBtn.style.display = "none";

  await waitForSVG();
  renderSeeder();
};

async function waitForSVG() {
  statusEl.innerText = "Finalizing node…";

  for (let i = 0; i < 6; i++) {
    try {
      const uri = await contract.tokenURI(ownedNode);
      if (uri && uri.includes("base64")) {
        const svg = decodeSVG(uri);
        renderNode(ownedNode, svg);
        statusEl.innerText = `You are Node ${ownedNode}. Not seeding.`;
        return;
      }
    } catch (_) {}

    await new Promise(r => setTimeout(r, 800));
  }

  statusEl.innerText = "Minted. Refresh if needed.";
}

/* =====================
   LOAD NODE (ONCE)
===================== */

async function loadNode() {
  const uri = await contract.tokenURI(ownedNode);
  const svg = decodeSVG(uri);

  renderNode(ownedNode, svg);
  statusEl.innerText = `You are Node ${ownedNode}. Not seeding.`;
}

/* =====================
   SEEDER UI
===================== */

function renderSeeder() {
  seederEl.innerHTML = "";

  const start = document.createElement("button");
  start.innerText = "Start seeding";

  const stop = document.createElement("button");
  stop.innerText = "Stop seeding";

  seederEl.append(start, stop);

  start.onclick = () => {
    if (seedWs) return;

    seedWs = new WebSocket("ws://" + location.host);
    seedWs.onopen = () => {
      seedWs.send(JSON.stringify({ node: ownedNode, wallet }));
      isSeeding = true;
      nodeLocked = true;
      statusEl.innerText = `You are Node ${ownedNode}. Seeding.`;
    };
  };

  stop.onclick = () => {
    if (!seedWs) return;

    seedWs.close();
    seedWs = null;
    isSeeding = false;
    nodeLocked = false;
    statusEl.innerText = `You are Node ${ownedNode}. Not seeding.`;
  };
}

/* =====================
   VIEWER WS
===================== */

const viewWs = new WebSocket("ws://" + location.host);

viewWs.onmessage = e => {
  const alive = JSON.parse(e.data);
  const up = Object.keys(alive).length;

  metricsEl.innerText = `up: ${up} / down: ${100 - up}`;
  walletsEl.innerText =
    up ? "active wallets: " + Object.values(alive).join(", ") : "";

  cells.forEach((c, i) => {
    const node = i + 1;

    if (nodeLocked && node === ownedNode) return;

    if (alive[node]) {
      c.style.background = "#fff";
    } else {
      c.style.background = "#111";
      c.innerHTML = "";
    }
  });
};



