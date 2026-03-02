import { encodePacked, keccak256 } from "viem";

function byteToHex(value) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function hexByteAt(hash, byteIndex) {
  const start = 2 + byteIndex * 2;
  return Number.parseInt(hash.slice(start, start + 2), 16);
}

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeDataUri(value, expectedPrefix) {
  if (typeof value !== "string" || !value.startsWith(expectedPrefix)) {
    throw new Error("Invalid data URI");
  }
  return base64ToUtf8(value.slice(expectedPrefix.length));
}

export function parseNodeTokenUri(tokenUri) {
  const metadataText = decodeDataUri(tokenUri, "data:application/json;base64,");
  const metadata = JSON.parse(metadataText);

  if (typeof metadata.image !== "string") {
    throw new Error("Token metadata image missing");
  }

  const svg = decodeDataUri(metadata.image, "data:image/svg+xml;base64,");
  return {
    metadata,
    svg
  };
}

export function parseTokenMetadata(tokenUri) {
  const metadataText = decodeDataUri(tokenUri, "data:application/json;base64,");
  return JSON.parse(metadataText);
}

export function deterministicNodeColor(nodeId) {
  const hash = keccak256(encodePacked(["uint256"], [BigInt(nodeId)]));

  const r = Math.floor(hexByteAt(hash, 0) / 2) + 64;
  const g = Math.floor(hexByteAt(hash, 1) / 2) + 64;
  const b = Math.floor(hexByteAt(hash, 2) / 2) + 64;

  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

export function fallbackNodeSvg(nodeId) {
  const color = deterministicNodeColor(nodeId);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    `<rect width="120" height="120" fill="${color}"/>` +
    "</svg>"
  );
}

export function svgToDataUri(svgText) {
  return `data:image/svg+xml;base64,${utf8ToBase64(svgText)}`;
}
