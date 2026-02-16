const ethers = window.ethers;

const DEFAULT_CHAIN_ID = 11155111;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

let config = null;
let browserProvider = null;
let signer = null;
let wallet = "";
let writeAuction = null;
let writeArtwork = null;
let writeNodes = null;
let readNodes = null;

let latestAuctionState = null;
let cachedPreviewSeedHash = "";
let cachedPreviewSvg = "";

const connectBtn = document.getElementById("connect");
const statusEl = document.getElementById("auction-status");

const stateRoundEl = document.getElementById("state-round");
const stateTerminalEl = document.getElementById("state-terminal");
const stateTerminalHashEl = document.getElementById("state-terminal-hash");
const stateAuctionRoundEl = document.getElementById("state-auction-round");
const stateAuctionActiveEl = document.getElementById("state-auction-active");
const stateFinalizedEl = document.getElementById("state-finalized");
const stateAuctionEndEl = document.getElementById("state-auction-end");
const stateHighestBidEl = document.getElementById("state-highest-bid");
const stateHighestBidderEl = document.getElementById("state-highest-bidder");
const stateYourNodeEl = document.getElementById("state-your-node");
const stateYourBidFlagEl = document.getElementById("state-your-bid-flag");
const stateYourRefundEl = document.getElementById("state-your-refund");
const stateFinalTokenEl = document.getElementById("state-final-token");

const auctionDurationEl = document.getElementById("auction-duration");
const bidEthEl = document.getElementById("bid-eth");

const activateAuctionBtn = document.getElementById("activate-auction");
const placeBidBtn = document.getElementById("place-bid");
const finalizeAuctionBtn = document.getElementById("finalize-auction");
const withdrawRefundBtn = document.getElementById("withdraw-refund");
const claimFinalBtn = document.getElementById("claim-final");
const resetRoundBtn = document.getElementById("reset-round");
const refreshAuctionBtn = document.getElementById("refresh-auction");

const previewImageEl = document.getElementById("final-svg-preview");
const previewNoteEl = document.getElementById("final-svg-note");

function setStatus(message) {
  statusEl.innerText = message;
}

function shortAddress(address) {
  if (!address || address.length < 10) return address || "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function formatTimestamp(seconds) {
  const asNumber = Number(seconds);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return "-";
  }

  const date = new Date(asNumber * 1000);
  return date.toLocaleString();
}

async function loadConfig() {
  const response = await fetch("/contract-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load contract config");
  }

  const loaded = await response.json();
  if (!loaded.nodes?.address || !Array.isArray(loaded.nodes?.abi)) {
    throw new Error("Missing nodes address/abi in contract-config.json");
  }
  if (!loaded.finalAuction?.address || !Array.isArray(loaded.finalAuction?.abi)) {
    throw new Error("Missing finalAuction address/abi in contract-config.json");
  }
  if (!loaded.finalArtwork?.address || !Array.isArray(loaded.finalArtwork?.abi)) {
    throw new Error("Missing finalArtwork address/abi in contract-config.json");
  }

  return loaded;
}

async function ensureExpectedChain() {
  const expectedChainId = Number(config.chainId || DEFAULT_CHAIN_ID);
  const network = await browserProvider.getNetwork();
  if (Number(network.chainId) === expectedChainId) {
    return;
  }

  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x" + expectedChainId.toString(16) }]
  });
}

function setPreviewSvg(svgText, seedHash) {
  if (!svgText) {
    previewImageEl.removeAttribute("src");
    previewNoteEl.innerText = "Terminal snapshot preview appears here when available.";
    return;
  }

  const dataUri = "data:image/svg+xml;base64," + utf8ToBase64(svgText);
  previewImageEl.src = dataUri;
  previewNoteEl.innerText = `Preview uses deterministic terminal SVG payload (${seedHash.slice(0, 10)}...).`;
}

async function fetchFinalSvg(seedHash) {
  if (cachedPreviewSeedHash === seedHash && cachedPreviewSvg) {
    return cachedPreviewSvg;
  }

  const response = await fetch("/final-artwork-svg", { cache: "no-store" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to fetch final artwork SVG");
  }

  if (payload.seedHash.toLowerCase() !== seedHash.toLowerCase()) {
    throw new Error("Terminal hash mismatch between auction state and preview SVG");
  }

  cachedPreviewSeedHash = payload.seedHash;
  cachedPreviewSvg = payload.svg;
  return cachedPreviewSvg;
}

async function fetchAuctionState() {
  const url = wallet
    ? `/auction-state?wallet=${encodeURIComponent(wallet)}`
    : "/auction-state";

  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to fetch auction state");
  }
  return payload;
}

async function refreshNodeOwnership() {
  if (!wallet || !readNodes) {
    stateYourNodeEl.innerText = "-";
    return;
  }

  const nodeId = Number(await readNodes.nodeOf(wallet));
  stateYourNodeEl.innerText = nodeId > 0 ? String(nodeId) : "none";
}

function applyAuctionState(state) {
  latestAuctionState = state;

  stateRoundEl.innerText = String(state.roundId);
  stateTerminalEl.innerText = state.terminal ? "yes" : "no";
  stateTerminalHashEl.innerText = state.terminalSeedHash || "-";
  stateAuctionRoundEl.innerText = String(state.auctionRoundId ?? "-");
  stateAuctionActiveEl.innerText = state.auctionActive ? "yes" : "no";
  stateFinalizedEl.innerText = state.finalized ? "yes" : "no";
  stateAuctionEndEl.innerText = formatTimestamp(state.auctionEnd);

  const highestBidEth = state.highestBidEth || "0.0";
  stateHighestBidEl.innerText = `${highestBidEth} ETH`;
  stateHighestBidderEl.innerText = state.highestBidder && state.highestBidder !== ethers.ZeroAddress
    ? state.highestBidder
    : "none";

  stateYourBidFlagEl.innerText = state.hasBidInRound ? "yes" : "no";
  stateYourRefundEl.innerText = `${state.pendingReturnsEth || "0.0"} ETH`;
  stateFinalTokenEl.innerText = String(state.finalArtworkTokenId ?? 0);
}

async function refreshAll() {
  const state = await fetchAuctionState();
  applyAuctionState(state);
  await refreshNodeOwnership();

  if (state.terminal && state.terminalSeedHash && state.terminalSeedHash !== ZERO_HASH) {
    try {
      const svg = await fetchFinalSvg(state.terminalSeedHash);
      setPreviewSvg(svg, state.terminalSeedHash);
    } catch (error) {
      setPreviewSvg("", "");
      previewNoteEl.innerText = error.message || "Could not load final SVG preview";
    }
  } else {
    cachedPreviewSeedHash = "";
    cachedPreviewSvg = "";
    setPreviewSvg("", "");
  }

  if (!wallet) {
    setStatus("Connect wallet to run bidding, finalize, claim, and reset actions.");
    return;
  }

  setStatus("Auction state synchronized.");
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  browserProvider = new ethers.BrowserProvider(window.ethereum);
  await ensureExpectedChain();
  signer = await browserProvider.getSigner();
  wallet = await signer.getAddress();

  writeNodes = new ethers.Contract(config.nodes.address, config.nodes.abi, signer);
  writeAuction = new ethers.Contract(config.finalAuction.address, config.finalAuction.abi, signer);
  writeArtwork = new ethers.Contract(config.finalArtwork.address, config.finalArtwork.abi, signer);

  readNodes = writeNodes;
  connectBtn.innerText = shortAddress(wallet);

  await refreshAll();
}

function requireWalletAndState() {
  if (!wallet || !signer || !writeAuction || !writeArtwork || !writeNodes) {
    throw new Error("Connect wallet first");
  }
  if (!latestAuctionState) {
    throw new Error("Auction state not loaded yet");
  }
}

async function runTx(label, action) {
  try {
    requireWalletAndState();
    setStatus(`${label}: waiting for wallet confirmation...`);
    const tx = await action();
    setStatus(`${label}: pending ${tx.hash}`);
    await tx.wait();
    setStatus(`${label}: confirmed`);
    await refreshAll();
  } catch (error) {
    setStatus(error.shortMessage || error.message || `${label} failed`);
  }
}

async function activateAuction() {
  const duration = Number.parseInt(auctionDurationEl.value, 10);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Invalid auction duration");
  }

  const seedHash = latestAuctionState.terminalSeedHash;
  if (!seedHash || seedHash === ZERO_HASH) {
    throw new Error("Terminal snapshot hash not available");
  }

  await runTx("Activate auction", () => writeAuction.activateAuction(seedHash, duration));
}

async function placeBid() {
  const raw = bidEthEl.value.trim();
  if (!raw) {
    throw new Error("Enter bid amount in ETH");
  }

  const value = ethers.parseEther(raw);
  await runTx("Place bid", () => writeAuction.bid({ value }));
}

async function finalizeAuction() {
  await runTx("Finalize auction", () => writeAuction.finalizeAuction());
}

async function withdrawRefund() {
  await runTx("Withdraw refund", () => writeAuction.withdrawRefund());
}

async function claimFinalArtwork() {
  const seedHash = latestAuctionState?.snapshotHash;
  if (!seedHash || seedHash === ZERO_HASH) {
    throw new Error("Auction snapshot hash not set");
  }

  const svg = await fetchFinalSvg(seedHash);
  await runTx("Claim final artwork", () => writeArtwork.claim(svg));
}

async function resetRound() {
  await runTx("Reset round", () => writeNodes.resetGame());
}

async function init() {
  config = await loadConfig();

  const readRpc = config.readRpc || "https://ethereum-sepolia-rpc.publicnode.com";
  const readProvider = new ethers.JsonRpcProvider(readRpc, Number(config.chainId || DEFAULT_CHAIN_ID));
  readNodes = new ethers.Contract(config.nodes.address, config.nodes.abi, readProvider);

  connectBtn.addEventListener("click", () => {
    connectWallet().catch((error) => {
      setStatus(error.shortMessage || error.message || "Wallet connect failed");
    });
  });

  activateAuctionBtn.addEventListener("click", () => {
    activateAuction().catch((error) => {
      setStatus(error.shortMessage || error.message || "Activate failed");
    });
  });

  placeBidBtn.addEventListener("click", () => {
    placeBid().catch((error) => {
      setStatus(error.shortMessage || error.message || "Bid failed");
    });
  });

  finalizeAuctionBtn.addEventListener("click", () => {
    finalizeAuction().catch((error) => {
      setStatus(error.shortMessage || error.message || "Finalize failed");
    });
  });

  withdrawRefundBtn.addEventListener("click", () => {
    withdrawRefund().catch((error) => {
      setStatus(error.shortMessage || error.message || "Withdraw failed");
    });
  });

  claimFinalBtn.addEventListener("click", () => {
    claimFinalArtwork().catch((error) => {
      setStatus(error.shortMessage || error.message || "Claim failed");
    });
  });

  resetRoundBtn.addEventListener("click", () => {
    resetRound().catch((error) => {
      setStatus(error.shortMessage || error.message || "Reset failed");
    });
  });

  refreshAuctionBtn.addEventListener("click", () => {
    refreshAll().catch((error) => {
      setStatus(error.message || "Refresh failed");
    });
  });

  await refreshAll();
  setInterval(() => {
    refreshAll().catch(() => {});
  }, 10000);

  window.ethereum?.on("accountsChanged", () => {
    wallet = "";
    signer = null;
    writeAuction = null;
    writeArtwork = null;
    writeNodes = null;
    connectBtn.innerText = "Connect Wallet";
    refreshAll().catch(() => {});
  });

  window.ethereum?.on("chainChanged", () => {
    window.location.reload();
  });
}

init().catch((error) => {
  setStatus(error.message || "Failed to initialize auction page");
});
