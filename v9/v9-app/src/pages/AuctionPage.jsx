import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useWriteContract
} from "wagmi";
import { formatEther, parseEther } from "viem";

import { fetchJson } from "../lib/api";
import { ZERO_HASH } from "../lib/constants";
import { formatTimestamp } from "../lib/format";
import { decodeDataUri, svgToDataUri } from "../lib/encoding";

const EXPECTED_SVG_RENDERER = "v9-pattern-canvas";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function yesNo(value) {
  return value ? "yes" : "no";
}

function displayAddress(value) {
  if (!value || value === "0x0000000000000000000000000000000000000000") {
    return "none";
  }
  return value;
}

export function AuctionPage({ config }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: config.chainId });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const [status, setStatus] = useState("Loading auction state...");
  const [auctionState, setAuctionState] = useState(null);
  const [auctionDuration, setAuctionDuration] = useState("300");
  const [bidAmount, setBidAmount] = useState("0.00002");
  const [walletNode, setWalletNode] = useState(0);
  const [previewSvgUri, setPreviewSvgUri] = useState("");
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  const isCorrectChain = !isConnected || chainId === config.chainId;
  const chainMismatch = isConnected && !isCorrectChain;

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchFinalSvg = useCallback(async (seedHash) => {
    const normalizedHash = (seedHash || "").toLowerCase();
    if (!normalizedHash || normalizedHash === ZERO_HASH) {
      return "";
    }

    const payload = await fetchJson("/final-artwork-svg");
    if (payload.svgRenderer !== EXPECTED_SVG_RENDERER) {
      throw new Error(
        "Legacy backend detected for /final-artwork-svg. Restart v9 backend and ensure it serves renderer v9-pattern-canvas."
      );
    }
    if (String(payload.seedHash || "").toLowerCase() !== normalizedHash) {
      throw new Error("Terminal hash mismatch between auction state and preview SVG");
    }

    const svgUri = svgToDataUri(payload.svg || "");
    return svgUri;
  }, []);

  const fetchAuctionState = useCallback(async () => {
    const query = address ? `?wallet=${encodeURIComponent(address)}` : "";
    return fetchJson(`/auction-state${query}`);
  }, [address]);

  const refreshAll = useCallback(async () => {
    const state = await fetchAuctionState();
    setAuctionState(state);

    if (address && publicClient) {
      try {
        const owned = await publicClient.readContract({
          address: config.nodes.address,
          abi: config.nodes.abi,
          functionName: "nodeOf",
          args: [address]
        });
        setWalletNode(Number(owned || 0n));
      } catch {
        setWalletNode(0);
      }
    } else {
      setWalletNode(0);
    }

    if (
      state.terminal &&
      typeof state.terminalSeedHash === "string" &&
      state.terminalSeedHash.toLowerCase() !== ZERO_HASH
    ) {
      try {
        const svgUri = await fetchFinalSvg(state.terminalSeedHash);
        setPreviewSvgUri(svgUri);
      } catch (error) {
        setPreviewSvgUri("");
        setStatus(error.message || "Could not load final SVG preview");
      }
    } else {
      setPreviewSvgUri("");
    }
  }, [config.nodes.abi, config.nodes.address, fetchAuctionState, fetchFinalSvg, publicClient]);

  useEffect(() => {
    refreshAll()
      .then(() => {
        setStatus(
          address
            ? "Auction state synchronized."
            : "Connect wallet to activate, bid, finalize, claim, and reset."
        );
      })
      .catch((error) => {
        setStatus(error.message || "Failed to fetch auction state");
      });

    const interval = setInterval(() => {
      refreshAll().catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, [address, refreshAll]);

  const runTx = useCallback(
    async (label, fn) => {
      if (!publicClient) {
        throw new Error("Public client unavailable");
      }
      if (!isConnected || !address) {
        throw new Error("Connect wallet first");
      }
      if (!isCorrectChain) {
        throw new Error("Switch wallet to Sepolia");
      }

      setStatus(`${label}: waiting for wallet confirmation...`);
      const txHash = await fn();
      setStatus(`${label}: pending ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStatus(`${label}: confirmed`);
      await refreshAll();
    },
    [address, isConnected, isCorrectChain, publicClient, refreshAll]
  );

  const activateAuction = async () => {
    if (!auctionState) {
      throw new Error("Auction state not ready");
    }

    const duration = Number.parseInt(auctionDuration, 10);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Invalid auction duration");
    }

    if (!auctionState.terminalSeedHash || auctionState.terminalSeedHash === ZERO_HASH) {
      throw new Error("Terminal snapshot hash not available");
    }

    await runTx("Activate auction", async () => {
      return writeContractAsync({
        address: config.finalAuction.address,
        abi: config.finalAuction.abi,
        functionName: "activateAuction",
        args: [auctionState.terminalSeedHash, BigInt(duration)],
        chainId: config.chainId
      });
    });
  };

  const placeBid = async () => {
    const raw = bidAmount.trim();
    if (!raw) {
      throw new Error("Enter bid amount in ETH");
    }

    const value = parseEther(raw);
    await runTx("Place bid", async () => {
      return writeContractAsync({
        address: config.finalAuction.address,
        abi: config.finalAuction.abi,
        functionName: "bid",
        value,
        chainId: config.chainId
      });
    });
  };

  const finalizeAuction = async () => {
    await runTx("Finalize auction", async () => {
      return writeContractAsync({
        address: config.finalAuction.address,
        abi: config.finalAuction.abi,
        functionName: "finalizeAuction",
        chainId: config.chainId
      });
    });
  };

  const withdrawRefund = async () => {
    await runTx("Withdraw refund", async () => {
      return writeContractAsync({
        address: config.finalAuction.address,
        abi: config.finalAuction.abi,
        functionName: "withdrawRefund",
        chainId: config.chainId
      });
    });
  };

  const claimFinalArtworkFromState = async (stateInput = auctionState) => {
    if (!stateInput?.snapshotHash || stateInput.snapshotHash === ZERO_HASH) {
      throw new Error("Auction snapshot hash not set");
    }

    const svgUri = await fetchFinalSvg(stateInput.snapshotHash);
    if (!svgUri.startsWith("data:image/svg+xml;base64,")) {
      throw new Error("Invalid SVG payload for final artwork claim");
    }
    const svg = decodeDataUri(svgUri, "data:image/svg+xml;base64,");

    await runTx("Claim final artwork", async () => {
      return writeContractAsync({
        address: config.finalArtwork.address,
        abi: config.finalArtwork.abi,
        functionName: "claim",
        args: [svg],
        chainId: config.chainId
      });
    });
  };

  const claimFinalArtwork = async () => {
    await claimFinalArtworkFromState(auctionState);
  };

  const finalizeAndClaimWinner = async () => {
    if (!auctionState) {
      throw new Error("Auction state not ready");
    }

    let latest = auctionState;
    const endTs = Number(latest.auctionEnd || 0);
    const hasEnded =
      Boolean(latest.auctionActive) && endTs > 0 && Math.floor(Date.now() / 1000) >= endTs;

    if (latest.auctionActive) {
      if (!hasEnded) {
        throw new Error("Auction still running");
      }

      await runTx("Finalize auction", async () => {
        return writeContractAsync({
          address: config.finalAuction.address,
          abi: config.finalAuction.abi,
          functionName: "finalizeAuction",
          chainId: config.chainId
        });
      });
      latest = await fetchAuctionState();
      setAuctionState(latest);
    }

    const tokenId = Number(latest.finalArtworkTokenId || 0);
    if (tokenId > 0) {
      setStatus(`Auction settled. Final artwork token #${tokenId} already minted.`);
      return;
    }

    const highest =
      typeof latest.highestBidder === "string" ? latest.highestBidder.toLowerCase() : "";
    const caller = (address || "").toLowerCase();
    if (!latest.finalized || !highest || highest === ZERO_ADDRESS) {
      setStatus("Auction closed without winner.");
      return;
    }
    if (!caller || caller !== highest) {
      setStatus("Auction finalized. Highest bidder wallet must claim final artwork.");
      return;
    }

    await claimFinalArtworkFromState(latest);
  };

  const resetRound = async () => {
    await runTx("Reset round", async () => {
      return writeContractAsync({
        address: config.nodes.address,
        abi: config.nodes.abi,
        functionName: "resetGame",
        chainId: config.chainId
      });
    });
  };

  const switchToSepolia = async () => {
    if (!switchChainAsync) {
      setStatus("Wallet does not support chain switching");
      return;
    }
    try {
      await switchChainAsync({ chainId: config.chainId });
      setStatus("Switched to Sepolia.");
    } catch (error) {
      setStatus(error.message || "Network switch failed");
    }
  };

  const highestBid = useMemo(() => {
    if (!auctionState) {
      return "0 ETH";
    }

    if (typeof auctionState.highestBidEth === "string") {
      return `${auctionState.highestBidEth} ETH`;
    }

    if (auctionState.highestBidWei) {
      return `${formatEther(BigInt(auctionState.highestBidWei))} ETH`;
    }

    return "0 ETH";
  }, [auctionState]);

  const auctionEndTs = Number(auctionState?.auctionEnd || 0);
  const auctionEnded = Boolean(auctionState?.auctionActive) && auctionEndTs > 0 && nowTs >= auctionEndTs;
  const auctionPhase = auctionState
    ? auctionState.auctionActive
      ? auctionEnded
        ? "ended (awaiting finalization)"
        : "running"
      : auctionState.finalized
        ? "finalized"
        : "inactive"
    : "-";

  return (
    <section className="panel control-grid">
      <h1 className="stack-title">Auction Console</h1>
      <p className="meta">{status}</p>

      {chainMismatch ? (
        <div className="network-warning">
          <span>Wallet is on the wrong network. Sepolia only.</span>
          <button
            type="button"
            className="app-btn"
            onClick={switchToSepolia}
            disabled={isSwitchingChain}
          >
            {isSwitchingChain ? "Switching..." : "Switch to Sepolia"}
          </button>
        </div>
      ) : null}

      <div className="kvs">
        <div className="kv">
          <strong>Round:</strong> <span>{auctionState?.roundId ?? "-"}</span>
        </div>
        <div className="kv">
          <strong>Terminal:</strong> <span>{yesNo(Boolean(auctionState?.terminal))}</span>
        </div>
        <div className="kv">
          <strong>Terminal Snapshot Hash:</strong> <span>{auctionState?.terminalSeedHash || "-"}</span>
        </div>
        <div className="kv">
          <strong>Auction Round:</strong> <span>{auctionState?.auctionRoundId ?? "-"}</span>
        </div>
        <div className="kv">
          <strong>Auction Active:</strong> <span>{yesNo(Boolean(auctionState?.auctionActive))}</span>
        </div>
        <div className="kv">
          <strong>Auction Phase:</strong> <span>{auctionPhase}</span>
        </div>
        <div className="kv">
          <strong>Finalized:</strong> <span>{yesNo(Boolean(auctionState?.finalized))}</span>
        </div>
        <div className="kv">
          <strong>Auction End:</strong> <span>{formatTimestamp(auctionState?.auctionEnd)}</span>
        </div>
        <div className="kv">
          <strong>Highest Bid:</strong> <span>{highestBid}</span>
        </div>
        <div className="kv">
          <strong>Highest Bidder:</strong> <span>{displayAddress(auctionState?.highestBidder)}</span>
        </div>
        <div className="kv">
          <strong>Your Node:</strong> <span>{walletNode > 0 ? walletNode : "none"}</span>
        </div>
        <div className="kv">
          <strong>Your Bid Placed:</strong> <span>{yesNo(Boolean(auctionState?.hasBidInRound))}</span>
        </div>
        <div className="kv">
          <strong>Your Refund:</strong> <span>{auctionState?.pendingReturnsEth || "0.0"} ETH</span>
        </div>
        <div className="kv">
          <strong>Final Token For Auction Round:</strong>{" "}
          <span>{auctionState?.finalArtworkTokenId ?? 0}</span>
        </div>
      </div>

      <div className="control-row">
        <div className="field">
          <label htmlFor="auction-duration">Auction Duration (sec)</label>
          <input
            id="auction-duration"
            type="number"
            min="30"
            step="1"
            value={auctionDuration}
            onChange={(event) => setAuctionDuration(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="app-btn"
          onClick={() => activateAuction().catch((error) => setStatus(error.message || "Activate failed"))}
        >
          Activate Auction
        </button>
      </div>

      <div className="control-row">
        <div className="field">
          <label htmlFor="bid-eth">Bid Amount (ETH)</label>
          <input
            id="bid-eth"
            type="text"
            value={bidAmount}
            onChange={(event) => setBidAmount(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="app-btn"
          onClick={() => placeBid().catch((error) => setStatus(error.message || "Bid failed"))}
        >
          Place Bid
        </button>
      </div>

      <div className="control-row">
        <button
          type="button"
          className="app-btn"
          onClick={() =>
            finalizeAndClaimWinner().catch((error) => setStatus(error.message || "Settle failed"))
          }
        >
          Finalize + Claim Winner
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => finalizeAuction().catch((error) => setStatus(error.message || "Finalize failed"))}
        >
          Finalize Auction
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => withdrawRefund().catch((error) => setStatus(error.message || "Withdraw failed"))}
        >
          Withdraw Refund
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => claimFinalArtwork().catch((error) => setStatus(error.message || "Claim failed"))}
        >
          Claim Final Artwork
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => resetRound().catch((error) => setStatus(error.message || "Reset failed"))}
        >
          Reset Round
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => refreshAll().catch((error) => setStatus(error.message || "Refresh failed"))}
        >
          Refresh
        </button>
      </div>

      <div className="preview-wrap">
        <div className="preview-frame">
          {previewSvgUri ? <img src={previewSvgUri} alt="Final artwork preview" /> : null}
        </div>
        <p className="small-note">
          {previewSvgUri
            ? "Preview uses deterministic terminal SVG payload."
            : "Terminal snapshot preview appears here when available."}
        </p>
      </div>
    </section>
  );
}
