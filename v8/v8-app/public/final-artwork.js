const ethers = window.ethers;

const DEFAULT_CHAIN_ID = 11155111;

let config = null;
let browserProvider = null;
let wallet = "";
let readNodes = null;
let readArtwork = null;

const connectBtn = document.getElementById("connect");
const statusEl = document.getElementById("final-status");
const roundInputEl = document.getElementById("round-input");
const loadRoundBtn = document.getElementById("load-round");
const loadLatestBtn = document.getElementById("load-latest");

const outRoundEl = document.getElementById("out-round");
const outTokenEl = document.getElementById("out-token");
const outOwnerEl = document.getElementById("out-owner");
const outSnapshotEl = document.getElementById("out-snapshot");
const outNameEl = document.getElementById("out-name");

const finalImageEl = document.getElementById("final-image");
const finalImageNoteEl = document.getElementById("final-image-note");

function setStatus(message) {
  statusEl.innerText = message;
}

function shortAddress(address) {
  if (!address || address.length < 10) return address || "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function decodeDataUri(text, expectedPrefix) {
  if (typeof text !== "string" || !text.startsWith(expectedPrefix)) {
    throw new Error("Invalid metadata data URI");
  }

  const base64 = text.slice(expectedPrefix.length);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseTokenMetadata(tokenUri) {
  const metadataText = decodeDataUri(tokenUri, "data:application/json;base64,");
  const metadata = JSON.parse(metadataText);
  return metadata;
}

function snapshotHashFromMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata.attributes)) {
    return "-";
  }

  for (const attribute of metadata.attributes) {
    if (attribute && attribute.trait_type === "Snapshot Hash") {
      return attribute.value || "-";
    }
  }

  return "-";
}

async function loadConfig() {
  const response = await fetch("/contract-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load contract config");
  }

  const loaded = await response.json();
  if (!loaded.nodes?.address || !Array.isArray(loaded.nodes?.abi)) {
    throw new Error("Missing nodes config");
  }
  if (!loaded.finalArtwork?.address || !Array.isArray(loaded.finalArtwork?.abi)) {
    throw new Error("Missing finalArtwork config");
  }
  return loaded;
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });
  browserProvider = new ethers.BrowserProvider(window.ethereum);

  const expectedChainId = Number(config.chainId || DEFAULT_CHAIN_ID);
  const network = await browserProvider.getNetwork();
  if (Number(network.chainId) !== expectedChainId) {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + expectedChainId.toString(16) }]
    });
  }

  const signer = await browserProvider.getSigner();
  wallet = await signer.getAddress();
  connectBtn.innerText = shortAddress(wallet);
  setStatus("Wallet connected. Read mode ready.");
}

function clearOutput() {
  outRoundEl.innerText = "-";
  outTokenEl.innerText = "-";
  outOwnerEl.innerText = "-";
  outSnapshotEl.innerText = "-";
  outNameEl.innerText = "-";
  finalImageEl.removeAttribute("src");
}

async function loadRound(roundId) {
  const round = Number(roundId);
  if (!Number.isInteger(round) || round < 1) {
    throw new Error("Invalid round");
  }

  setStatus(`Loading final artwork for round ${round}...`);

  const tokenId = Number(await readArtwork.tokenIdByRound(round));

  if (!tokenId) {
    clearOutput();
    outRoundEl.innerText = String(round);
    setStatus(`Round ${round} has no final artwork minted yet.`);
    finalImageNoteEl.innerText = "No final artwork minted for this round.";
    return;
  }

  const [owner, tokenUri] = await Promise.all([
    readArtwork.ownerOf(tokenId),
    readArtwork.tokenURI(tokenId)
  ]);

  const metadata = parseTokenMetadata(tokenUri);
  const image = metadata.image || "";

  outRoundEl.innerText = String(round);
  outTokenEl.innerText = String(tokenId);
  outOwnerEl.innerText = owner;
  outSnapshotEl.innerText = snapshotHashFromMetadata(metadata);
  outNameEl.innerText = metadata.name || "-";

  if (typeof image === "string" && image.startsWith("data:image/svg+xml;base64,")) {
    finalImageEl.src = image;
    finalImageNoteEl.innerText = "On-chain SVG loaded from tokenURI.";
  } else {
    finalImageEl.removeAttribute("src");
    finalImageNoteEl.innerText = "Image payload is not an on-chain SVG data URI.";
  }

  setStatus(`Loaded final artwork token #${tokenId} for round ${round}.`);
}

async function loadLatestMintedRound() {
  const currentRound = Number(await readNodes.roundId());

  for (let round = currentRound; round >= 1; round -= 1) {
    const tokenId = Number(await readArtwork.tokenIdByRound(round));
    if (tokenId > 0) {
      roundInputEl.value = String(round);
      await loadRound(round);
      return;
    }
  }

  clearOutput();
  setStatus("No final artwork minted yet.");
  finalImageNoteEl.innerText = "No final artwork minted yet.";
}

async function init() {
  config = await loadConfig();

  const readRpc = config.readRpc || "https://ethereum-sepolia-rpc.publicnode.com";
  const readProvider = new ethers.JsonRpcProvider(readRpc, Number(config.chainId || DEFAULT_CHAIN_ID));

  readNodes = new ethers.Contract(config.nodes.address, config.nodes.abi, readProvider);
  readArtwork = new ethers.Contract(config.finalArtwork.address, config.finalArtwork.abi, readProvider);

  connectBtn.addEventListener("click", () => {
    connectWallet().catch((error) => {
      setStatus(error.shortMessage || error.message || "Wallet connect failed");
    });
  });

  loadRoundBtn.addEventListener("click", () => {
    loadRound(roundInputEl.value).catch((error) => {
      setStatus(error.message || "Load round failed");
    });
  });

  loadLatestBtn.addEventListener("click", () => {
    loadLatestMintedRound().catch((error) => {
      setStatus(error.message || "Load latest failed");
    });
  });

  await loadLatestMintedRound();

  window.ethereum?.on("accountsChanged", () => {
    wallet = "";
    connectBtn.innerText = "Connect Wallet";
  });

  window.ethereum?.on("chainChanged", () => {
    window.location.reload();
  });
}

init().catch((error) => {
  setStatus(error.message || "Failed to initialize final artwork page");
});
