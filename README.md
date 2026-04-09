## Pixel2Pixel

### Status
- This repository is an exploration and a currently shelved idea, not an actively maintained product.
- Expect rough edges, abandoned paths, inconsistent documentation between versions, and generally messy implementation details.
- It is public mainly to invite suggestions, feedback, and outside perspective on the concept and execution.

### Project Summary
Pixel2Pixel is a cyclical participation artwork built around 100 ERC721 nodes per round.
Each node has deterministic on-chain SVG identity, and live seeding determines active participation.

### Version Summary
- v0: Basic canvas with ID-based URL seeding.
- v1: Color canvas with node up/down metrics.
- v2: Added node unavailable metric on canvas.
- v3: Removed ID seeding; added mock minting with cipher seeding URLs.
- v4: Mock wallet seeding with unified canvas and metrics.
- v5: Real wallets with on-chain minting on testnet.
- v6: Sepolia contract deployment and frontend decode/render from on-chain SVG.
- v7: Production round loop primitives:
  - `NodesV7` with one mint per wallet, max supply 100, `gameActive`, and `roundId` reset signal.
  - Off-chain seeding auth via signed messages + WS live state.
  - Terminal freeze + reproducible snapshot.
  - `FinalAuction` 1/1 flow for node-owner bidding.
  - Deterministic post-auction shuffle support.
- v8: Stable rehearsal/live-ops baseline on Sepolia:
  - 100-node mint + signed websocket seeding + terminal lock.
  - Auction activate/bid/finalize/withdraw.
  - Winner claim of deterministic final artwork NFT.
  - Round reset with deterministic shuffled carry-over.
- v9: Frontend architecture upgrade (current):
  - React (Vite), wagmi, viem, RainbowKit.
  - React routes: `/`, `/auction`, `/final`.
  - Same contracts/mechanics as v8.
  - Pattern-preview logic modularized under `src/patterns`.

### Latest Version
- Latest workspace explored: `v9/`
- `v7` remains locked.
- `v8` remains a stable reference/handoff baseline.

### v9 Contracts Rehearsal Quick Steps
Path: `v9/v9-contracts`

1. Copy `.env.example` to `.env` and set:
   - `SEPOLIA_RPC`
   - `PRIVATE_KEY` (burner)
   - `REHEARSAL_MNEMONIC` (burner)
2. Run:
```bash
npm install
npm run compile
npm test
npm run deploy:sepolia
npm run check:sepolia
npm run rehearsal:sepolia
```
3. If rehearsal stops on gas cap, retry later instead of forcing higher spend.

### v9 App Rehearsal Quick Steps
Path: `v9/v9-app`

1. Install deps:
```bash
npm install
```
2. Run backend server:
```bash
npm start
```
3. In another terminal run frontend:
```bash
npm run dev
```
4. Use:
   - `http://localhost:5173/` for mint + seeding
   - `http://localhost:5173/auction` for activate/bid/finalize/claim/reset
   - `http://localhost:5173/final` to verify minted final NFT metadata/SVG
5. For mnemonic-derived rehearsal wallets, run helper:
```bash
npm run rehearsal:seed-all
```
6. Stop helper:
```bash
npm run rehearsal:seed-all:stop
```

### v9 End-to-End Rehearsal Flow
1. Confirm contracts deployed and app `contract-config.json` points to the deployed addresses.
2. Open `/` and mint up to `100/100` (distributed wallets).
3. Keep all nodes seeded until terminal lock (`100/100` seeded).
4. Open `/auction` and verify terminal snapshot hash is present.
5. Activate auction, place bids, and finalize after duration.
6. Winner claims final artwork.
7. Reset round and verify next-round shuffled mapping.
8. Open `/final` and verify minted token data for the completed round.

### Handoffs
- v8 execution handoff: `v8/HANDOFF.md`

### Secrets Policy
- Never commit `.env` or `.env.*` files.
- Never paste private keys or seed phrases.
