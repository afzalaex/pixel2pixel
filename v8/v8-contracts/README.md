# Pixel2Pixel v8 Contracts

## Contracts
- `NodesV8`:
  - ERC721 nodes with deterministic on-chain SVG.
  - One mint per wallet and fixed `MAX_SUPPLY = 100`.
  - Round-aware terminal anchors:
    - `finalSnapshotHash` / `finalSnapshotHashByRound`
    - `finalArtworkTokenId` / `finalArtworkTokenIdByRound`
  - `lockFinalSnapshot(bytes32)` to anchor off-chain terminal snapshot hash on-chain.
  - `registerFinalArtworkToken(uint256)` called by `FinalArtwork` on winner claim.
  - `shuffleSeed()` = `keccak256(finalSnapshotHash + roundId)` for deterministic shuffle inputs.
  - `resetGame()` requires both snapshot lock and final artwork mint for the round.
- `FinalAuction`:
  - Separate auction contract activated with terminal snapshot hash.
  - Only current node owners can bid in ETH.
  - Enforces one bid per wallet per round.
  - If a round ends with no bids, auction closes without a winner and can be re-opened for the same round using the same snapshot hash.
  - Finalizes winner and payout; `FinalArtwork` handles NFT minting.
- `FinalArtwork`:
  - Winner-only claim after auction finalization.
  - Mints final 1/1 NFT with deterministic SVG passed at claim time.
  - Embeds SVG and snapshot hash in on-chain Base64 metadata.

## Local Commands
```bash
npm install
npm run compile
npm test
npm run deploy:sepolia
npm run check:sepolia
npm run rehearsal:sepolia
```

## Deployment Output
- Deploy script writes `deployments/<network>.json` with:
  - `nodesV8.address`
  - `finalAuction.address`
  - `finalArtwork.address`

## Sepolia Rehearsal
1. Copy `.env.example` to `.env` and fill only burner credentials.
2. Fund the burner deployer wallet with Sepolia ETH.
3. Run:
```bash
npm run deploy:sepolia
npm run check:sepolia
npm run rehearsal:sepolia
```
4. The rehearsal script executes an end-to-end round:
   - funds derived rehearsal wallets
   - mints to 100 total nodes
   - activates auction with a snapshot hash
   - places bids from node holders
   - finalizes auction
   - winner claims final artwork NFT (deterministic 10x10 canvas SVG, not placeholder)
   - resets round
   - supports repeated multi-round rehearsal with stale-round guards

Low-balance notes:
- For a balance like `0.0875` Sepolia ETH, keep `LOW_BALANCE_MODE=true`.
- Script now funds wallets just-in-time per action instead of pre-funding all wallets.
- It caps execution to `MAX_GAS_PRICE_GWEI` (default `3`) and aborts if gas is higher.
- Keep `WITHDRAW_REFUNDS=false` to save gas during rehearsal.
- If you only change `.env` gas/budget settings, redeploy is not required.
- Re-run `npm run check:sepolia` then `npm run rehearsal:sepolia`.

UI rehearsal note:
- For full user-path validation (seeding presence + auction controls), use `v8/v8-app` pages:
  - `/`
  - `/auction.html`
  - `/final-artwork.html`

Security notes:
- Use burner keys only.
- Keep `.env` local (already gitignored).
- Rotate burner keys after rehearsal.
- Never paste keys or seed phrases into docs, commits, or chat.
