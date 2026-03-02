import { keccak256 } from "viem";
import { MAX_NODES } from "./constants";

export function normalizeShuffleSeed(seed) {
  if (typeof seed !== "string") {
    return "";
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) {
    return "";
  }

  const zero =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  if (seed.toLowerCase() === zero) {
    return "";
  }

  return seed;
}

export function buildShufflePositions(seedHash, size = MAX_NODES) {
  const positions = Array.from({ length: size }, (_, index) => index);
  let entropy = seedHash;

  for (let i = positions.length - 1; i > 0; i -= 1) {
    entropy = keccak256(entropy);
    const pick = Number(BigInt(entropy) % BigInt(i + 1));
    const temp = positions[i];
    positions[i] = positions[pick];
    positions[pick] = temp;
  }

  return positions;
}

export function buildNodeLayout(totalSupply, normalizedShuffleSeed, patternCellOrder) {
  const cap = Math.max(0, Math.min(Number(totalSupply) || 0, MAX_NODES));
  const cellToNode = new Array(MAX_NODES).fill(0);
  const nodeToCell = new Map();

  const hasShuffle = typeof normalizedShuffleSeed === "string" && normalizedShuffleSeed.length > 0;
  if (hasShuffle) {
    const positions = buildShufflePositions(normalizedShuffleSeed, MAX_NODES);
    for (let nodeId = 1; nodeId <= cap; nodeId += 1) {
      const mappedIndex = positions[nodeId - 1];
      const cellIndex = patternCellOrder[mappedIndex];
      cellToNode[cellIndex] = nodeId;
      nodeToCell.set(nodeId, cellIndex);
    }
    return { cellToNode, nodeToCell };
  }

  for (let nodeId = 1; nodeId <= cap; nodeId += 1) {
    const cellIndex = patternCellOrder[nodeId - 1];
    cellToNode[cellIndex] = nodeId;
    nodeToCell.set(nodeId, cellIndex);
  }

  return { cellToNode, nodeToCell };
}
