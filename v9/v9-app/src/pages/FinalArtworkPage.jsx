import { useCallback, useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseTokenMetadata } from "../lib/encoding";

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

function defaultOutput() {
  return {
    round: "-",
    tokenId: "-",
    owner: "-",
    snapshotHash: "-",
    name: "-",
    imageUri: "",
    imageNote: "Select a round to view minted final artwork."
  };
}

export function FinalArtworkPage({ config }) {
  const publicClient = usePublicClient({ chainId: config.chainId });
  const [status, setStatus] = useState("Loading final artwork state...");
  const [roundInput, setRoundInput] = useState("1");
  const [output, setOutput] = useState(defaultOutput);

  const loadRound = useCallback(
    async (roundValue) => {
      if (!publicClient) {
        throw new Error("Public client unavailable");
      }

      const round = Number(roundValue);
      if (!Number.isInteger(round) || round < 1) {
        throw new Error("Invalid round");
      }

      setStatus(`Loading final artwork for round ${round}...`);
      const tokenIdRaw = await publicClient.readContract({
        address: config.finalArtwork.address,
        abi: config.finalArtwork.abi,
        functionName: "tokenIdByRound",
        args: [BigInt(round)]
      });
      const tokenId = Number(tokenIdRaw || 0n);

      if (!tokenId) {
        setOutput({
          ...defaultOutput(),
          round: String(round),
          imageNote: `Round ${round} has no final artwork minted yet.`
        });
        setStatus(`Round ${round} has no final artwork minted yet.`);
        return;
      }

      const [owner, tokenUri] = await Promise.all([
        publicClient.readContract({
          address: config.finalArtwork.address,
          abi: config.finalArtwork.abi,
          functionName: "ownerOf",
          args: [BigInt(tokenId)]
        }),
        publicClient.readContract({
          address: config.finalArtwork.address,
          abi: config.finalArtwork.abi,
          functionName: "tokenURI",
          args: [BigInt(tokenId)]
        })
      ]);

      const metadata = parseTokenMetadata(tokenUri);
      const imageUri =
        typeof metadata.image === "string" && metadata.image.startsWith("data:image/svg+xml;base64,")
          ? metadata.image
          : "";

      setOutput({
        round: String(round),
        tokenId: String(tokenId),
        owner,
        snapshotHash: snapshotHashFromMetadata(metadata),
        name: metadata.name || "-",
        imageUri,
        imageNote: imageUri
          ? "On-chain SVG loaded from tokenURI."
          : "Image payload is not an on-chain SVG data URI."
      });

      setStatus(`Loaded final artwork token #${tokenId} for round ${round}.`);
    },
    [config.finalArtwork.abi, config.finalArtwork.address, publicClient]
  );

  const loadLatestMintedRound = useCallback(async () => {
    if (!publicClient) {
      throw new Error("Public client unavailable");
    }

    const currentRoundRaw = await publicClient.readContract({
      address: config.nodes.address,
      abi: config.nodes.abi,
      functionName: "roundId",
      args: []
    });
    const currentRound = Number(currentRoundRaw || 1n);

    for (let round = currentRound; round >= 1; round -= 1) {
      const tokenIdRaw = await publicClient.readContract({
        address: config.finalArtwork.address,
        abi: config.finalArtwork.abi,
        functionName: "tokenIdByRound",
        args: [BigInt(round)]
      });
      if (Number(tokenIdRaw || 0n) > 0) {
        setRoundInput(String(round));
        await loadRound(round);
        return;
      }
    }

    setOutput({
      ...defaultOutput(),
      imageNote: "No final artwork minted yet."
    });
    setStatus("No final artwork minted yet.");
  }, [
    config.finalArtwork.abi,
    config.finalArtwork.address,
    config.nodes.abi,
    config.nodes.address,
    loadRound,
    publicClient
  ]);

  useEffect(() => {
    loadLatestMintedRound().catch((error) => {
      setStatus(error.message || "Load latest failed");
    });
  }, [loadLatestMintedRound]);

  const hasImage = useMemo(() => output.imageUri && output.imageUri.length > 0, [output.imageUri]);

  return (
    <section className="panel control-grid">
      <h1 className="stack-title">Final Artwork</h1>
      <p className="meta">{status}</p>

      <div className="control-row">
        <div className="field">
          <label htmlFor="round-input">Round</label>
          <input
            id="round-input"
            type="number"
            min="1"
            step="1"
            value={roundInput}
            onChange={(event) => setRoundInput(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="app-btn"
          onClick={() => loadRound(roundInput).catch((error) => setStatus(error.message || "Load round failed"))}
        >
          Load Round
        </button>
        <button
          type="button"
          className="app-btn"
          onClick={() => loadLatestMintedRound().catch((error) => setStatus(error.message || "Load latest failed"))}
        >
          Load Latest Minted
        </button>
      </div>

      <div className="kvs">
        <div className="kv">
          <strong>Round:</strong> <span>{output.round}</span>
        </div>
        <div className="kv">
          <strong>Token ID:</strong> <span>{output.tokenId}</span>
        </div>
        <div className="kv">
          <strong>Owner:</strong> <span>{output.owner}</span>
        </div>
        <div className="kv">
          <strong>Snapshot Hash:</strong> <span>{output.snapshotHash}</span>
        </div>
        <div className="kv">
          <strong>Name:</strong> <span>{output.name}</span>
        </div>
      </div>

      <div className="preview-wrap">
        <div className="preview-frame">
          {hasImage ? <img src={output.imageUri} alt="Final artwork token image" /> : null}
        </div>
        <p className="small-note">{output.imageNote}</p>
      </div>
    </section>
  );
}
