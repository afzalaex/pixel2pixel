const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const TOTAL_NODES = 100;
const DEFAULT_WALLET_COUNT = 100;
const DEFAULT_FUND_PER_WALLET_ETH = "0.002";
const DEFAULT_BID_INCREMENT_ETH = "0.00001";
const DEFAULT_AUCTION_DURATION_SECONDS = 60;
const DEFAULT_LOW_BALANCE_MODE = true;
const DEFAULT_WITHDRAW_REFUNDS = false;
const DEFAULT_TX_GAS_SAFETY_BPS = 14000;
const DEFAULT_TX_GAS_FLAT_BUFFER_ETH = "0.00002";
const DEFAULT_MAX_GAS_PRICE_GWEI = "3";
const GRID_COLUMNS = 10;
const CELL_SIZE = 60;
const CANVAS_SIZE = GRID_COLUMNS * CELL_SIZE;

function loadDeployment(networkName) {
  const filePath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Deployment file not found: ${filePath}. Run deploy first (npm run deploy:sepolia).`
    );
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parsePositiveInt(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

function parseBoolean(raw, fallback) {
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }

  throw new Error(`Invalid boolean: ${raw}`);
}

function toAddressMap(wallets) {
  const map = new Map();
  for (const wallet of wallets) {
    map.set(wallet.address.toLowerCase(), wallet);
  }
  return map;
}

function decodeDataUri(uri, prefix) {
  if (typeof uri !== "string" || !uri.startsWith(prefix)) {
    throw new Error("Invalid data URI");
  }
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

function decodeNodeSvgFromTokenUri(tokenUri) {
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
  const packed = hre.ethers.solidityPacked(["uint256"], [BigInt(nodeId)]);
  const hash = hre.ethers.getBytes(hre.ethers.keccak256(packed));

  const r = Math.floor(hash[0] / 2) + 64;
  const g = Math.floor(hash[1] / 2) + 64;
  const b = Math.floor(hash[2] / 2) + 64;

  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

async function colorForNode(nodes, nodeId, colorCache) {
  if (colorCache.has(nodeId)) {
    return colorCache.get(nodeId);
  }

  let color = deterministicColor(nodeId);
  try {
    const tokenUri = await nodes.tokenURI(nodeId);
    const svgText = decodeNodeSvgFromTokenUri(tokenUri);
    const parsed = extractPrimaryFill(svgText);
    if (parsed) {
      color = parsed;
    }
  } catch {
    // Use deterministic fallback color.
  }

  colorCache.set(nodeId, color);
  return color;
}

async function buildDeterministicSvg(nodes) {
  const colorCache = new Map();
  const rects = [];

  for (let nodeId = 1; nodeId <= TOTAL_NODES; nodeId += 1) {
    const color = await colorForNode(nodes, nodeId, colorCache);
    const index = nodeId - 1;
    const row = Math.floor(index / GRID_COLUMNS);
    const col = index % GRID_COLUMNS;
    const x = col * CELL_SIZE;
    const y = row * CELL_SIZE;
    rects.push(
      `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${color}"/>`
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">`,
    `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#000000"/>`,
    ...rects,
    "</svg>",
  ].join("");
}

function chooseSnapshotHash(roundId, existingSnapshot) {
  if (existingSnapshot !== hre.ethers.ZeroHash) {
    return existingSnapshot;
  }

  const override = process.env.REHEARSAL_SNAPSHOT_HASH;
  if (override) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(override)) {
      throw new Error("REHEARSAL_SNAPSHOT_HASH must be a 32-byte hex string");
    }
    return override;
  }

  return hre.ethers.id(`p2p-v8-sepolia-round-${roundId.toString()}`);
}

async function assertHasCode(address, label) {
  const code = await hre.ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} has no code at ${address}`);
  }
}

async function currentGasPriceWei() {
  const feeData = await hre.ethers.provider.getFeeData();
  if (feeData.maxFeePerGas && feeData.maxFeePerGas > 0n) {
    return feeData.maxFeePerGas;
  }
  if (feeData.gasPrice && feeData.gasPrice > 0n) {
    return feeData.gasPrice;
  }
  return hre.ethers.parseUnits("2", "gwei");
}

async function ensureGasPriceWithin(maxGasPriceWei) {
  const gasPrice = await currentGasPriceWei();
  if (gasPrice > maxGasPriceWei) {
    throw new Error(
      `Gas price too high for low-budget run: ${hre.ethers.formatUnits(gasPrice, "gwei")} gwei > ${hre.ethers.formatUnits(maxGasPriceWei, "gwei")} gwei. Retry later.`
    );
  }
  return gasPrice;
}

async function minimumBalanceForTx(signer, txRequest, fundingOptions) {
  const gasPrice = await ensureGasPriceWithin(fundingOptions.maxGasPriceWei);
  const gasEstimate = await signer.estimateGas(txRequest);
  const value = txRequest.value == null ? 0n : BigInt(txRequest.value.toString());
  const gasCost = gasEstimate * gasPrice;
  const paddedGasCost =
    (gasCost * BigInt(fundingOptions.gasSafetyBps)) / 10000n + fundingOptions.flatBufferWei;

  return value + paddedGasCost;
}

async function fundWalletIfNeeded(funder, wallet, minBalance, label) {
  const balance = await hre.ethers.provider.getBalance(wallet.address);
  if (balance >= minBalance) {
    return;
  }

  const delta = minBalance - balance;
  const tx = await funder.sendTransaction({ to: wallet.address, value: delta });
  await tx.wait();
  console.log(`  funded ${label}: +${hre.ethers.formatEther(delta)} ETH`);
}

async function ensureFunding(funder, wallets, targetBalance) {
  console.log(`Funding wallets to at least ${hre.ethers.formatEther(targetBalance)} ETH each...`);

  for (let i = 0; i < wallets.length; i += 1) {
    const wallet = wallets[i];
    const balance = await hre.ethers.provider.getBalance(wallet.address);
    if (balance >= targetBalance) {
      continue;
    }

    const delta = targetBalance - balance;
    const tx = await funder.sendTransaction({ to: wallet.address, value: delta });
    await tx.wait();

    if ((i + 1) % 10 === 0 || i === wallets.length - 1) {
      console.log(`  funded ${i + 1}/${wallets.length}`);
    }
  }
}

async function mintUntilFull(nodes, wallets, fundingOptions) {
  let supply = await nodes.totalSupply();
  if (supply >= BigInt(TOTAL_NODES)) {
    console.log(`Mint already complete: ${supply.toString()}/${TOTAL_NODES}`);
    return;
  }

  console.log(`Minting nodes to reach ${TOTAL_NODES}...`);
  for (let i = 0; i < wallets.length; i += 1) {
    const wallet = wallets[i];
    if (supply >= BigInt(TOTAL_NODES)) {
      break;
    }

    const nodeId = await nodes.nodeOf(wallet.address);
    const hasMinted = await nodes.hasMinted(wallet.address);

    if (nodeId !== 0n || hasMinted) {
      continue;
    }

    if (fundingOptions.lowBalanceMode) {
      const mintTx = await nodes.connect(wallet).mint.populateTransaction();
      const minBalance = await minimumBalanceForTx(wallet, mintTx, fundingOptions);
      await fundWalletIfNeeded(fundingOptions.funder, wallet, minBalance, `wallet ${i}`);
    }

    const tx = await nodes.connect(wallet).mint();
    await tx.wait();

    supply = await nodes.totalSupply();
    if (supply % 10n === 0n || supply === BigInt(TOTAL_NODES)) {
      console.log(`  minted ${supply.toString()}/${TOTAL_NODES}`);
    }
  }

  const finalSupply = await nodes.totalSupply();
  if (finalSupply !== BigInt(TOTAL_NODES)) {
    throw new Error(`Unable to reach 100 mints (current supply: ${finalSupply.toString()})`);
  }
}

async function ensureBids(auction, nodes, wallets, roundId, bidIncrement, fundingOptions) {
  const highestBidder = await auction.highestBidder();
  const targetBids =
    highestBidder === hre.ethers.ZeroAddress
      ? fundingOptions.lowBalanceMode
        ? 1
        : 2
      : 1;
  let placed = 0;

  for (let i = 0; i < wallets.length; i += 1) {
    const wallet = wallets[i];
    if (placed >= targetBids) {
      break;
    }

    const alreadyBid = await auction.hasBidInRound(roundId, wallet.address);
    if (alreadyBid) {
      continue;
    }

    const nodeId = await nodes.nodeOf(wallet.address);
    if (nodeId === 0n) {
      continue;
    }

    const owner = await nodes.ownerOf(nodeId);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      continue;
    }

    const highestBid = await auction.highestBid();
    const bidAmount = highestBid + bidIncrement;
    if (fundingOptions.lowBalanceMode) {
      const bidTx = await auction
        .connect(wallet)
        .bid.populateTransaction({ value: bidAmount });
      const minBalance = await minimumBalanceForTx(wallet, bidTx, fundingOptions);
      await fundWalletIfNeeded(fundingOptions.funder, wallet, minBalance, `bidder ${i}`);
    } else {
      const walletBalance = await hre.ethers.provider.getBalance(wallet.address);
      if (walletBalance <= bidAmount) {
        continue;
      }
    }

    const tx = await auction.connect(wallet).bid({ value: bidAmount });
    await tx.wait();
    placed += 1;
  }

  if ((await auction.highestBidder()) === hre.ethers.ZeroAddress) {
    throw new Error("Could not place a valid bid. Fund rehearsal wallets and retry.");
  }
}

async function waitUntilAuctionEnd(auction) {
  const end = Number(await auction.auctionEnd());
  const latestBlock = await hre.ethers.provider.getBlock("latest");
  const now = latestBlock.timestamp;
  if (now >= end) {
    return;
  }

  const waitSeconds = end - now + 2;
  console.log(`Waiting ${waitSeconds}s for auction end...`);
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
}

async function maybeWithdrawRefunds(auction, wallets, enabled, fundingOptions) {
  if (!enabled) {
    return;
  }

  for (const wallet of wallets) {
    const pending = await auction.pendingReturns(wallet.address);
    if (pending === 0n) {
      continue;
    }

    if (fundingOptions.lowBalanceMode) {
      const withdrawTx = await auction.connect(wallet).withdrawRefund.populateTransaction();
      const minBalance = await minimumBalanceForTx(wallet, withdrawTx, fundingOptions);
      await fundWalletIfNeeded(
        fundingOptions.funder,
        wallet,
        minBalance,
        `refund ${wallet.address.slice(0, 8)}`
      );
    }

    const tx = await auction.connect(wallet).withdrawRefund();
    await tx.wait();
  }
}

async function main() {
  if (hre.network.name !== "sepolia") {
    console.log(`Warning: network is '${hre.network.name}', expected 'sepolia'.`);
  }

  const deployment = loadDeployment(hre.network.name);
  const nodesAddress = deployment.nodesV8?.address;
  const auctionAddress = deployment.finalAuction?.address;
  const finalArtworkAddress = deployment.finalArtwork?.address;

  if (!nodesAddress || !auctionAddress || !finalArtworkAddress) {
    throw new Error("Deployment file is missing contract addresses");
  }

  await assertHasCode(nodesAddress, "NodesV8");
  await assertHasCode(auctionAddress, "FinalAuction");
  await assertHasCode(finalArtworkAddress, "FinalArtwork");

  const [deployer] = await hre.ethers.getSigners();
  const mnemonic = mustEnv("REHEARSAL_MNEMONIC");
  const walletCount = parsePositiveInt(
    process.env.REHEARSAL_WALLET_COUNT || `${DEFAULT_WALLET_COUNT}`,
    "REHEARSAL_WALLET_COUNT"
  );
  const lowBalanceMode = parseBoolean(
    process.env.LOW_BALANCE_MODE,
    DEFAULT_LOW_BALANCE_MODE
  );
  const withdrawRefunds = parseBoolean(
    process.env.WITHDRAW_REFUNDS,
    DEFAULT_WITHDRAW_REFUNDS
  );
  const gasSafetyBps = parsePositiveInt(
    process.env.TX_GAS_SAFETY_BPS || `${DEFAULT_TX_GAS_SAFETY_BPS}`,
    "TX_GAS_SAFETY_BPS"
  );
  const flatBufferWei = hre.ethers.parseEther(
    process.env.TX_GAS_FLAT_BUFFER_ETH || DEFAULT_TX_GAS_FLAT_BUFFER_ETH
  );
  const maxGasPriceWei = hre.ethers.parseUnits(
    process.env.MAX_GAS_PRICE_GWEI || DEFAULT_MAX_GAS_PRICE_GWEI,
    "gwei"
  );

  const fundPerWallet = hre.ethers.parseEther(
    process.env.FUND_PER_WALLET_ETH || DEFAULT_FUND_PER_WALLET_ETH
  );
  const bidIncrement = hre.ethers.parseEther(
    process.env.BID_INCREMENT_ETH || DEFAULT_BID_INCREMENT_ETH
  );
  const auctionDurationSeconds = parsePositiveInt(
    process.env.AUCTION_DURATION_SECONDS || `${DEFAULT_AUCTION_DURATION_SECONDS}`,
    "AUCTION_DURATION_SECONDS"
  );

  const NodesV8 = await hre.ethers.getContractFactory("NodesV8");
  const FinalAuction = await hre.ethers.getContractFactory("FinalAuction");
  const FinalArtwork = await hre.ethers.getContractFactory("FinalArtwork");

  const nodes = NodesV8.attach(nodesAddress);
  const auction = FinalAuction.attach(auctionAddress);
  const finalArtwork = FinalArtwork.attach(finalArtworkAddress);

  console.log("Loaded deployment:");
  console.log(`  NodesV8: ${nodesAddress}`);
  console.log(`  FinalAuction: ${auctionAddress}`);
  console.log(`  FinalArtwork: ${finalArtworkAddress}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  lowBalanceMode: ${lowBalanceMode}`);
  console.log(`  maxGasPriceGwei: ${hre.ethers.formatUnits(maxGasPriceWei, "gwei")}`);

  const wallets = [];
  for (let i = 0; i < walletCount; i += 1) {
    const wallet = hre.ethers.HDNodeWallet.fromPhrase(
      mnemonic,
      undefined,
      `m/44'/60'/0'/0/${i}`
    ).connect(hre.ethers.provider);
    wallets.push(wallet);
  }
  const walletByAddress = toAddressMap(wallets);

  const currentSupply = await nodes.totalSupply();
  const remainingToMint = Number(BigInt(TOTAL_NODES) - currentSupply);
  if (remainingToMint > 0 && walletCount < remainingToMint) {
    throw new Error(
      `REHEARSAL_WALLET_COUNT (${walletCount}) is too low; need at least ${remainingToMint} wallets for remaining mints`
    );
  }

  const fundingOptions = {
    funder: deployer,
    lowBalanceMode,
    gasSafetyBps,
    flatBufferWei,
    maxGasPriceWei,
  };

  if (!lowBalanceMode) {
    await ensureFunding(deployer, wallets, fundPerWallet);
  } else {
    await ensureGasPriceWithin(maxGasPriceWei);
  }

  await mintUntilFull(nodes, wallets, fundingOptions);

  const roundId = await nodes.roundId();
  console.log(`Starting rehearsal for round ${roundId.toString()}`);

  let finalTokenId = await nodes.finalArtworkTokenIdByRound(roundId);
  let attempts = 0;
  while (finalTokenId === 0n && attempts < 4) {
    attempts += 1;

    const auctionRoundId = await auction.auctionRoundId();
    const auctionActive = await auction.auctionActive();
    const finalized = await auction.finalized();
    const hasStaleAuctionRound = auctionRoundId !== 0n && auctionRoundId !== roundId;

    if (hasStaleAuctionRound) {
      if (auctionActive) {
        throw new Error(
          `Auction is still active for round ${auctionRoundId.toString()} while current round is ${roundId.toString()}.`
        );
      }

      if (finalized) {
        const previousRoundArtworkTokenId = await nodes.finalArtworkTokenIdByRound(
          auctionRoundId
        );
        if (previousRoundArtworkTokenId === 0n) {
          throw new Error(
            `Previous round ${auctionRoundId.toString()} is finalized but artwork is still unclaimed.`
          );
        }
      }
    }

    if (!auctionActive && (!finalized || hasStaleAuctionRound)) {
      const existingSnapshot = await nodes.finalSnapshotHashByRound(roundId);
      const snapshotHash = chooseSnapshotHash(roundId, existingSnapshot);
      const tx = await auction
        .connect(deployer)
        .activateAuction(snapshotHash, auctionDurationSeconds);
      await tx.wait();
      console.log(`Auction activated with snapshot ${snapshotHash}`);
    }

    if (await auction.auctionActive()) {
      await ensureBids(auction, nodes, wallets, roundId, bidIncrement, fundingOptions);
      await waitUntilAuctionEnd(auction);
      if (await auction.auctionActive()) {
        const finalizeTx = await auction.connect(deployer).finalizeAuction();
        await finalizeTx.wait();
      }
    }

    if (await auction.finalized()) {
      const finalizedRoundId = await auction.auctionRoundId();
      if (finalizedRoundId !== roundId) {
        throw new Error(
          `Auction finalized for round ${finalizedRoundId.toString()} while current round is ${roundId.toString()}.`
        );
      }

      const winner = await auction.highestBidder();
      const winnerWallet = walletByAddress.get(winner.toLowerCase());
      if (!winnerWallet) {
        throw new Error(
          `Winner ${winner} is not in REHEARSAL_MNEMONIC derived wallets; cannot claim automatically.`
        );
      }

      if ((await finalArtwork.tokenIdByRound(roundId)) === 0n) {
        const snapshotHash = await auction.snapshotHash();
        const deterministicSvg = await buildDeterministicSvg(nodes);
        if (fundingOptions.lowBalanceMode) {
          const claimTxData = await finalArtwork
            .connect(winnerWallet)
            .claim.populateTransaction(deterministicSvg);
          const minBalance = await minimumBalanceForTx(
            winnerWallet,
            claimTxData,
            fundingOptions
          );
          await fundWalletIfNeeded(
            fundingOptions.funder,
            winnerWallet,
            minBalance,
            `winner ${winnerWallet.address.slice(0, 8)}`
          );
        }
        const claimTx = await finalArtwork.connect(winnerWallet).claim(deterministicSvg);
        await claimTx.wait();
        console.log(`Final artwork claimed by ${winner}`);
      }

      await maybeWithdrawRefunds(
        auction,
        wallets.slice(0, 15),
        withdrawRefunds,
        fundingOptions
      );
    }

    finalTokenId = await nodes.finalArtworkTokenIdByRound(roundId);
  }

  if (finalTokenId === 0n) {
    throw new Error("Final artwork token was not minted for this round");
  }

  if ((await nodes.roundId()) === roundId) {
    const resetTx = await nodes.connect(deployer).resetGame();
    await resetTx.wait();
    console.log(`Round reset complete. New round: ${(await nodes.roundId()).toString()}`);
  }

  console.log("Sepolia rehearsal completed.");
  console.log(`Round completed: ${roundId.toString()}`);
  console.log(`Final artwork token id: ${finalTokenId.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
