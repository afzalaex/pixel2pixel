import { useCallback, useEffect, useState } from "react";
import { parseAbi } from "viem";
import { DEFAULT_CHAIN_ID, DEFAULT_RPC } from "../lib/constants";
import { fetchJson } from "../lib/api";

function normalizeContract(contractConfig, label) {
  if (!contractConfig || typeof contractConfig !== "object") {
    throw new Error(`Missing ${label} contract config`);
  }

  if (typeof contractConfig.address !== "string" || !contractConfig.address) {
    throw new Error(`Missing ${label}.address`);
  }

  if (!Array.isArray(contractConfig.abi) || contractConfig.abi.length === 0) {
    throw new Error(`Missing ${label}.abi`);
  }

  return {
    address: contractConfig.address,
    abi: parseAbi(contractConfig.abi)
  };
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") {
    throw new Error("Invalid contract-config payload");
  }

  return {
    network: rawConfig.network || "sepolia",
    chainId: Number(rawConfig.chainId || DEFAULT_CHAIN_ID),
    readRpc: rawConfig.readRpc || DEFAULT_RPC,
    nodes: normalizeContract(rawConfig.nodes, "nodes"),
    finalAuction: normalizeContract(rawConfig.finalAuction, "finalAuction"),
    finalArtwork: normalizeContract(rawConfig.finalArtwork, "finalArtwork")
  };
}

export function useAppConfig() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [config, setConfig] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const raw = await fetchJson("/contract-config.json");
      setConfig(normalizeConfig(raw));
    } catch (loadError) {
      setConfig(null);
      setError(loadError.message || "Failed to load contract config");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return {
    config,
    error,
    isLoading,
    reload: load
  };
}
