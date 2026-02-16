# Pixel2Pixel v8 App

## Version Summary
- Canvas runtime keeps the fixed `10 x 10` deterministic node rendering baseline from v7.
- Navbar is monochrome and reduced to logo + `Connect Wallet`.
- Terminal snapshot now captures participation fields (`nodeId`, `wallet`, `activatedAt`, `activationOrder`) and derives a deterministic `seedHash`.
- Auction and final artwork pages are now interactive UIs (wallet actions, on-chain reads, terminal SVG preview/claim).
- Final artwork SVG API now returns deterministic full-canvas SVG (10x10 node compilation, no extra overlays).
- Round handling is now explicit: auction finalization is treated as valid only for the current round to prevent stale-round shuffle leakage.

## Runtime
```bash
npm install
npm start
```

### Rehearsal Seeding Helper
When mints are distributed across mnemonic-derived rehearsal wallets, you can keep seeding alive without opening 100 tabs:

```bash
# from v8/v8-app
npm run rehearsal:seed-all
```

Stop helper:
```bash
npm run rehearsal:seed-all:stop
```

Env controls:
- `REHEARSAL_MNEMONIC` (or `SEED_MNEMONIC`): required
- `SEED_COUNT` (default `100`)
- `SEED_HOLD_SECONDS` (default `180`, set `0` to hold until Ctrl+C)
- `SEED_SERVER_URL` (default `http://localhost:8080`)
- `SEED_WS_URL` (optional explicit WS URL)

## UI Pages
- Canvas + mint + seeding: `http://localhost:8080/`
- Auction console (activate, bid, finalize, claim, reset): `http://localhost:8080/auction.html`
- Final artwork viewer (round -> tokenURI -> SVG): `http://localhost:8080/final-artwork.html`

## Basic UI Simulation
- Open `http://localhost:8080/?testingMode=1`
- Use controls to simulate `minted` and `seeded` counts without wallet actions.
- Pattern composition preview: `http://localhost:8080/pattern-preview.html`

## Server APIs (for UI rehearsal)
- `GET /round-state`
- `GET /terminal-snapshot`
- `GET /auction-state?wallet=0x...` (wallet query optional)
- `GET /final-artwork-svg`
- `GET /final-artwork-preview.svg`

## Required Config
Update `contract-config.json` with deployed:
- `nodes.address`
- `finalAuction.address`
- `finalArtwork.address`
- `nodes.abi`, `finalAuction.abi`, and `finalArtwork.abi` must include the runtime methods used by UI pages.

## Manual Rehearsal (UI)
1. Open canvas page and mint up to `100/100` supply (distributed wallets).
2. Keep all nodes seeded until terminal locks:
   - real users: each owner seeds from their own wallet session
   - rehearsal wallets: run `npm run rehearsal:seed-all`
3. Open auction page and confirm terminal snapshot hash is present.
4. Activate auction with terminal snapshot hash.
5. Place bids from node-owner wallets.
6. Finalize auction after end time.
7. Winner clicks `Claim Final Artwork` (uses deterministic SVG payload from `/final-artwork-svg`).
8. Owner clicks `Reset Round`.

## Mapping Rules (Important)
- Terminal reached (`100/100 seeded`) locks seeding and freezes canvas state.
- Shuffle for the next live round appears after auction finalize + winner claim + reset.
- Canvas payload includes mapping diagnostics (`mapping`, `auctionRound`, `finalized(current)`) so stale-round finalization is visible.
