const ethers = window.ethers;

/* =====================
   CONFIG
===================== */

const CONTRACT = "0xe1F630391a58290D955Dd43E6d74688f612C0422";
const ABI = [
  "function mint() public",
  "function nodeOf(address) view returns (uint256)"
];

/* =====================
   STATE
===================== */

let provider, signer, contract;
let wallet = null;
let ownedNode = 0;

let seedWs = null;
let isSeeding = false;

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
   GRID (STATIC INIT)
===================== */

const grid = document.getElementById("grid");
const cells = [];

for (let i = 1; i <= 100; i++) {
  const c = document.createElement("div");
  c.className = "cell";
  grid.appendChild(c);
  cells.push(c);
}

const color = n => `hsl(${(n * 137) % 360},70%,60%)`;

/* =====================
   RESET
===================== */

function resetUI() {
  wallet = null;
  ownedNode = 0;
  isSeeding = false;

  if (seedWs) {
    seedWs.close();
    seedWs = null;
  }

  connectBtn.innerText = "Connect";
  mintBtn.style.display = "none";
  seederEl.style.display = "none";
  seederEl.innerHTML = "";

  statusEl.innerText = "Connect wallet to participate";
  metricsEl.innerText = "";
  walletsEl.innerText = "";

  cells.forEach(c => (c.style.background = "#111"));
}

/* =====================
   CONNECT
===================== */

connectBtn.onclick = async () => {
  if (!window.ethereum) return alert("MetaMask not detected");

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  wallet = await signer.getAddress();
  contract = new ethers.Contract(CONTRACT, ABI, signer);

  connectBtn.innerText =
    wallet.slice(0, 6) + "..." + wallet.slice(-4);

  await checkOwnership();
};

window.ethereum?.on("accountsChanged", resetUI);

/* =====================
   OWNERSHIP
===================== */

async function checkOwnership() {
  statusEl.innerText = "Checking ownership…";

  ownedNode = Number(await contract.nodeOf(wallet));

  if (ownedNode === 0) {
    mintBtn.style.display = "block";
    statusEl.innerText = "Mint to participate";
    return;
  }

  // owner path
  mintBtn.style.display = "none";
  renderSeeder();

  statusEl.innerText = isSeeding
    ? `You are Node ${ownedNode}. You are seeding.`
    : `You are Node ${ownedNode}. You are not seeding.`;
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

  statusEl.innerText =
    `You are Node ${ownedNode}. You are not seeding.`;

  renderSeeder();
};

/* =====================
   SEEDER (ONLY TRUTH)
===================== */

function renderSeeder() {
  seederEl.innerHTML = "";
  seederEl.style.display = "flex";

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
      statusEl.innerText =
        `You are Node ${ownedNode}. You are seeding.`;
    };
  };

  stop.onclick = () => {
    if (!seedWs) return;

    seedWs.close();
    seedWs = null;
    isSeeding = false;

    statusEl.innerText =
      `You are Node ${ownedNode}. You are not seeding.`;
  };
}

/* =====================
   VIEWER WS (PIXEL TRUTH)
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

    // 🔒 Your node is ONLY painted if WS says so
    if (alive[node]) {
      c.style.background = color(node);
    } else {
      c.style.background = "#111";
    }
  });
};



