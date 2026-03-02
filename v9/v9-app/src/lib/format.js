export function shortAddress(address) {
  if (!address || typeof address !== "string" || address.length < 10) {
    return address || "-";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(seconds) {
  const asNumber = Number(seconds);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return "-";
  }
  return new Date(asNumber * 1000).toLocaleString();
}
