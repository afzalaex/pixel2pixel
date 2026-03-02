export function seedMessage(nonce) {
  // Keep exact v8 message for backend signature verification compatibility.
  return `P2P v8 seeding authorization\nNonce: ${nonce}`;
}
