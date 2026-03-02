import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWriteContract
} from "wagmi";

import { fetchJson } from "../lib/api";
import { MAX_NODES, ZERO_HASH } from "../lib/constants";
import { fallbackNodeSvg, parseNodeTokenUri, svgToDataUri } from "../lib/encoding";
import { buildNodeLayout, normalizeShuffleSeed } from "../lib/layout";
import { useSeedingSocket } from "../hooks/useSeedingSocket";
import { BRAND_COLORS, buildPatternCellOrder, patternLabel } from "../patterns/engine";
import { patternConfigForRound } from "../patterns/selection";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAlive(rawAlive) {
  const out = {};
  if (!rawAlive || typeof rawAlive !== "object") {
    return out;
  }

  for (const [key, wallet] of Object.entries(rawAlive)) {
    const node = Number(key);
    if (
      Number.isInteger(node) &&
      node >= 1 &&
      node <= MAX_NODES &&
      typeof wallet === "string" &&
      wallet.length > 0
    ) {
      out[node] = wallet;
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
    /^0x[0-9a-fA-F]{64}$/.test(rawSnapshot.seedHash) &&
    rawSnapshot.seedHash.toLowerCase() !== ZERO_HASH
      ? rawSnapshot.seedHash
      : "";

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
    seedHash,
    nodeIds
  };
}

function defaultRoundState() {
  return {
    alive: {},
    totalSupply: 0,
    roundId: 1,
    auctionRoundId: 0,
    auctionFinalizedCurrentRound: false,
    terminal: false,
    snapshot: null,
    shuffleSeed: "",
    shuffleSourceRound: 0,
    awaitingAuction: false,
    shuffleReady: false
  };
}

function statusMessage({
  terminal,
  shuffleReady,
  shuffleSourceRound,
  totalSupply,
  hasWallet,
  ownedNode,
  hasMinted,
  isSeeding
}) {
  if (terminal) {
    if (shuffleReady) {
      return "Terminal locked. Auction finalized. Claim + reset to start the next shuffled round.";
    }
    return "Terminal locked. Snapshot captured. Seeding is frozen until auction finalization.";
  }

  if (totalSupply >= MAX_NODES) {
    if (shuffleReady) {
      return `All 100 nodes minted. Round is live on shuffled layout from round ${shuffleSourceRound || "?"}.`;
    }
    return "All 100 nodes minted. Round is live.";
  }

  if (!hasWallet) {
    return "Mint phase open. Connect wallet to participate.";
  }

  if (ownedNode === 0) {
    if (hasMinted) {
      return "Mint phase open. This wallet already used its one mint.";
    }
    return "Mint phase open. Connected wallet can mint one node.";
  }

  if (isSeeding) {
    return `Mint phase open. You are Node ${ownedNode} and seeding is active.`;
  }

  return `Mint phase open. You are Node ${ownedNode} and seeding is off.`;
}

function progressText(totalSupply, seededCount) {
  const seeded = Math.max(0, Math.min(seededCount, MAX_NODES));
  const minted = Math.max(0, Math.min(totalSupply, MAX_NODES));
  const seededRemaining = MAX_NODES - seeded;
  const mintRemaining = MAX_NODES - minted;
  return `Seeding for final artwork: ${seeded} / ${MAX_NODES} | Remaining to final artwork: ${seededRemaining} | Minted remaining: ${mintRemaining}`;
}

function metricText(roundState, patternName) {
  const activeCount = Object.keys(roundState.alive).length;
  const mappingLabel = roundState.shuffleReady
    ? `shuffled (src round ${roundState.shuffleSourceRound || "?"})`
    : "natural";
  return `minted: ${roundState.totalSupply} / 100 | seeding: ${activeCount} / 100 | mapping: ${mappingLabel} | pattern: ${patternName} | auctionRound: ${roundState.auctionRoundId || "-"} | finalized(current): ${roundState.auctionFinalizedCurrentRound ? "yes" : "no"}`;
}

export function CanvasPage({ config }) {
  const [roundState, setRoundState] = useState(defaultRoundState);
  const [actionStatus, setActionStatus] = useState("Round state synchronizing...");
  const [seedingEnabled, setSeedingEnabled] = useState(false);
  const [minting, setMinting] = useState(false);
  const [nodeImages, setNodeImages] = useState({});
  const nodeImagesRef = useRef({});
  const pendingNodeFetchRef = useRef(new Map());

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: config.chainId });
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const isCorrectChain = !isConnected || chainId === config.chainId;

  const {
    data: ownedNodeData,
    refetch: refetchOwnedNode,
    isFetching: isFetchingOwnedNode
  } = useReadContract({
    address: config.nodes.address,
    abi: config.nodes.abi,
    functionName: "nodeOf",
    args: [address || ZERO_ADDRESS],
    chainId: config.chainId,
    query: {
      enabled: Boolean(address)
    }
  });

  const {
    data: hasMintedData,
    refetch: refetchHasMinted,
    isFetching: isFetchingHasMinted
  } = useReadContract({
    address: config.nodes.address,
    abi: config.nodes.abi,
    functionName: "hasMinted",
    args: [address || ZERO_ADDRESS],
    chainId: config.chainId,
    query: {
      enabled: Boolean(address)
    }
  });

  const ownedNode = Number(ownedNodeData || 0n);
  const walletHasMinted = Boolean(hasMintedData || ownedNode > 0);

  const applyRoundPayload = useCallback((payload) => {
    const alive = normalizeAlive(payload.alive);
    const nextState = {
      alive,
      totalSupply: Math.max(0, Math.min(Number(payload.totalSupply || 0), MAX_NODES)),
      roundId: Math.max(1, Number(payload.roundId || 1)),
      auctionRoundId: Math.max(0, Number(payload.auctionRoundId || 0)),
      auctionFinalizedCurrentRound: Boolean(payload.auctionFinalizedCurrentRound),
      terminal: Boolean(payload.terminal),
      snapshot: normalizeSnapshot(payload.snapshot),
      shuffleSeed: normalizeShuffleSeed(payload.shuffleSeed),
      shuffleSourceRound: Math.max(0, Number(payload.shuffleSourceRound || 0)),
      awaitingAuction: Boolean(payload.awaitingAuction),
      shuffleReady: Boolean(normalizeShuffleSeed(payload.shuffleSeed))
    };

    setRoundState(nextState);
    if (nextState.terminal) {
      setSeedingEnabled(false);
    }
  }, []);

  const fetchRoundState = useCallback(async () => {
    const payload = await fetchJson("/round-state");
    applyRoundPayload(payload);
  }, [applyRoundPayload]);

  useEffect(() => {
    fetchRoundState()
      .then(() => {
        setActionStatus("Round state synchronized.");
      })
      .catch((error) => {
        setActionStatus(error.message || "Failed to fetch round state");
      });

    const interval = setInterval(() => {
      fetchRoundState().catch(() => {});
    }, 12000);

    return () => {
      clearInterval(interval);
    };
  }, [fetchRoundState]);

  useEffect(() => {
    nodeImagesRef.current = nodeImages;
  }, [nodeImages]);

  useEffect(() => {
    if (!isConnected || ownedNode <= 0 || roundState.terminal || !isCorrectChain) {
      setSeedingEnabled(false);
    }
  }, [isConnected, isCorrectChain, ownedNode, roundState.terminal]);

  const { isSeeding } = useSeedingSocket(address || "", roundState.roundId, {
    enabled:
      seedingEnabled &&
      Boolean(address) &&
      ownedNode > 0 &&
      !roundState.terminal &&
      isCorrectChain,
    nodeId: ownedNode,
    signMessageAsync,
    onAlive: applyRoundPayload,
    onStatus: (message) => setActionStatus(message),
    onError: (message) => {
      setActionStatus(message);
      setSeedingEnabled(false);
    }
  });

  const ensureNodeImage = useCallback(
    async (nodeId) => {
      if (!publicClient) {
        return;
      }

      if (nodeImagesRef.current[nodeId]) {
        return;
      }

      if (pendingNodeFetchRef.current.has(nodeId)) {
        await pendingNodeFetchRef.current.get(nodeId);
        return;
      }

      const request = (async () => {
        let src = "";
        try {
          const tokenUri = await publicClient.readContract({
            address: config.nodes.address,
            abi: config.nodes.abi,
            functionName: "tokenURI",
            args: [BigInt(nodeId)]
          });
          const parsed = parseNodeTokenUri(tokenUri);
          src = svgToDataUri(parsed.svg);
        } catch {
          src = svgToDataUri(fallbackNodeSvg(nodeId));
        } finally {
          pendingNodeFetchRef.current.delete(nodeId);
        }

        setNodeImages((previous) => {
          if (previous[nodeId] === src) {
            return previous;
          }
          return {
            ...previous,
            [nodeId]: src
          };
        });
      })();

      pendingNodeFetchRef.current.set(nodeId, request);
      await request;
    },
    [config.nodes.abi, config.nodes.address, publicClient]
  );

  const aliveNodeIds = useMemo(() => {
    return Object.keys(roundState.alive)
      .map((value) => Number(value))
      .filter(
        (nodeId) =>
          Number.isInteger(nodeId) && nodeId >= 1 && nodeId <= roundState.totalSupply
      )
      .sort((a, b) => a - b);
  }, [roundState.alive, roundState.totalSupply]);

  const aliveNodeKey = useMemo(() => aliveNodeIds.join(","), [aliveNodeIds]);
  useEffect(() => {
    if (!aliveNodeIds.length) {
      return;
    }

    Promise.allSettled(aliveNodeIds.map((nodeId) => ensureNodeImage(nodeId))).catch(
      () => {}
    );
  }, [aliveNodeKey, aliveNodeIds, ensureNodeImage]);

  const patternConfig = useMemo(
    () => patternConfigForRound(roundState.roundId),
    [roundState.roundId]
  );
  const patternCellOrder = useMemo(
    () => buildPatternCellOrder(patternConfig),
    [
      patternConfig.key,
      patternConfig.rotation,
      patternConfig.mirrorX,
      patternConfig.mirrorY,
      patternConfig.phase
    ]
  );

  const layout = useMemo(() => {
    return buildNodeLayout(
      roundState.totalSupply,
      normalizeShuffleSeed(roundState.shuffleSeed),
      patternCellOrder
    );
  }, [patternCellOrder, roundState.shuffleSeed, roundState.totalSupply]);

  const roundSummary = useMemo(() => {
    return statusMessage({
      terminal: roundState.terminal,
      shuffleReady: roundState.shuffleReady,
      shuffleSourceRound: roundState.shuffleSourceRound,
      totalSupply: roundState.totalSupply,
      hasWallet: Boolean(address),
      ownedNode,
      hasMinted: walletHasMinted,
      isSeeding
    });
  }, [
    address,
    isSeeding,
    ownedNode,
    roundState.shuffleReady,
    roundState.shuffleSourceRound,
    roundState.terminal,
    roundState.totalSupply,
    walletHasMinted
  ]);

  const canMint =
    Boolean(address) &&
    isCorrectChain &&
    !roundState.terminal &&
    roundState.totalSupply < MAX_NODES &&
    ownedNode === 0 &&
    !walletHasMinted;

  const showSeeder = Boolean(address) && isCorrectChain && ownedNode > 0 && !roundState.terminal;
  const seededCount = Object.keys(roundState.alive).length;
  const progressPercent = Math.max(0, Math.min(100, (seededCount / MAX_NODES) * 100));

  const walletLine = useMemo(() => {
    if (roundState.terminal && roundState.snapshot) {
      return (
        `snapshot -> block ${roundState.snapshot.blockNumber} | ts ${roundState.snapshot.timestamp} | ` +
        `seed ${roundState.snapshot.seedHash}` +
        (roundState.awaitingAuction ? " | next: finalize auction, claim, reset" : "")
      );
    }

    const activeWallets = Object.values(roundState.alive);
    if (!activeWallets.length) {
      return "active wallets: none";
    }
    return `active wallets: ${activeWallets.join(", ")}`;
  }, [roundState.alive, roundState.awaitingAuction, roundState.snapshot, roundState.terminal]);

  const handleSwitchChain = async () => {
    try {
      if (!switchChainAsync) {
        throw new Error("Wallet does not support chain switching");
      }
      await switchChainAsync({ chainId: config.chainId });
      setActionStatus("Switched to Sepolia.");
    } catch (error) {
      setActionStatus(error.message || "Network switch failed");
    }
  };

  const handleMint = async () => {
    if (!publicClient) {
      setActionStatus("Public client unavailable");
      return;
    }

    if (!isCorrectChain) {
      setActionStatus("Switch to Sepolia before minting.");
      return;
    }

    setMinting(true);
    try {
      setActionStatus("Mint: waiting for wallet confirmation...");
      const txHash = await writeContractAsync({
        address: config.nodes.address,
        abi: config.nodes.abi,
        functionName: "mint",
        chainId: config.chainId
      });

      setActionStatus(`Mint: pending ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setActionStatus("Mint confirmed.");

      await Promise.all([refetchOwnedNode(), refetchHasMinted(), fetchRoundState()]);
    } catch (error) {
      setActionStatus(error.shortMessage || error.message || "Mint failed");
    } finally {
      setMinting(false);
    }
  };

  const loadingOwnership = isFetchingOwnedNode || isFetchingHasMinted;
  const patternName = patternLabel(patternConfig.key);
  const chainMismatch = isConnected && !isCorrectChain;

  return (
    <>
      <div className="page-hero">
        <h1 className="page-title">Pixel2Pixel</h1>
        <p className="page-caption">
          A p2p canvas where nodes are pixels and every node must be present to complete the
          final artwork.
        </p>
      </div>

      <section className="panel">
        <div className="meta">{roundSummary}</div>
        <div className="meta">{actionStatus}</div>
        {chainMismatch ? (
          <div className="network-warning">
            <span>Wallet is on the wrong network. Sepolia only.</span>
            <button
              type="button"
              className="app-btn"
              onClick={handleSwitchChain}
              disabled={isSwitchingChain}
            >
              {isSwitchingChain ? "Switching..." : "Switch to Sepolia"}
            </button>
          </div>
        ) : null}

        <div className="meta">{metricText(roundState, patternName)}</div>

        <div className="final-progress-block">
          <div className="final-progress-text">
            {progressText(roundState.totalSupply, seededCount)}
          </div>
          <div className="final-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
            <div className="final-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="final-progress-note">
            When all nodes are seeded, terminal snapshot locks, auction finalizes, winner claims,
            and reset advances the round with deterministic shuffle.
          </p>
        </div>

        <div className="grid-wrap">
          <div className="grid" id="grid">
            {layout.cellToNode.map((nodeId, cellIndex) => {
              const wallet = nodeId ? roundState.alive[nodeId] : "";
              const src = nodeId ? nodeImages[nodeId] : "";
              const fallbackColor = BRAND_COLORS[(nodeId - 1 + MAX_NODES) % MAX_NODES];

              return (
                <div
                  className={wallet ? "cell seeded" : "cell"}
                  key={cellIndex}
                  title={wallet ? `${nodeId} - ${wallet}` : ""}
                >
                  {wallet && src ? (
                    <img src={src} alt={`Node ${nodeId}`} />
                  ) : wallet ? (
                    <div className="cell-fallback" style={{ background: fallbackColor }} />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {canMint ? (
          <button
            id="mint"
            type="button"
            className="app-btn"
            onClick={handleMint}
            disabled={minting || loadingOwnership}
          >
            {minting ? "Minting..." : "Mint Pixel"}
          </button>
        ) : null}

        {showSeeder ? (
          <div id="seeder">
            {!seedingEnabled ? (
              <button
                type="button"
                className="app-btn"
                onClick={() => {
                  setSeedingEnabled(true);
                  setActionStatus(`Node ${ownedNode}: opening seeding socket...`);
                }}
              >
                Start seeding
              </button>
            ) : (
              <button
                type="button"
                className="app-btn"
                onClick={() => {
                  setSeedingEnabled(false);
                  setActionStatus(`Node ${ownedNode}: seeding stopped`);
                }}
              >
                Stop seeding
              </button>
            )}
          </div>
        ) : null}

        <div className="wallets">{walletLine}</div>
      </section>
    </>
  );
}
