# Pixel2Pixel v8 Handoff

## Current State
- Status: `v8` is stable for current scope and ready for continued rehearsal/live-ops testing.
- Branch: `main`
- Network target: `Sepolia`

## Deployed Sepolia Contracts
- `NodesV8`: `0x9459D54c0D8A80ae7C71AcdE5f7bFD61F54ab266`
- `FinalAuction`: `0xDbaEC79042FA742812DAecEf530bF892b201a59E`
- `FinalArtwork`: `0x35f21738e17cC01cF59892Fa67bEaEB23D514DeA`

## What Works End-to-End
- 100-node mint flow.
- Signed websocket seeding flow.
- Terminal lock when `totalSupply == 100` and `activeSeedCount == 100`.
- Auction activation/bid/finalize/withdraw in UI.
- Winner claim of final artwork NFT in UI.
- Final artwork SVG now uses exact 10x10 canvas node compilation (no extra decorative overlays).
- Round reset + next-round shuffled layout carry-over.
- Repeated multi-round rehearsal supported.

## Important Behavior Notes
- Nodes persist across rounds in current v8 contracts.
- `totalSupply` remains `100` after first full mint cycle.
- Reset increments `roundId` and clears round anchors, but does not remint/burn nodes.
- Shuffle visibility in live round depends on prior round completion:
  - finalize auction
  - claim final artwork
  - reset round

## Key Fixes Added Late
- Rehearsal script stale-round guard fixed for multi-round runs.
- Rehearsal final SVG generation changed from placeholder art to real 10x10 canvas composition.
- App shuffle bug fixed by using round-scoped auction finalization (prevents previous-round finalized state from leaking into current round mapping).
- Added explicit seed-all process stop path and PID lock.

## Operational Commands

### Contracts
```bash
cd v8/v8-contracts
npm run check:sepolia
npm run rehearsal:sepolia
```

### App
```bash
cd v8/v8-app
npm start
```

### Rehearsal seeding helper
```bash
cd v8/v8-app
npm run rehearsal:seed-all
npm run rehearsal:seed-all:stop
```

## Rehearsal UI URLs
- Canvas: `/`
- Auction: `/auction.html`
- Final artwork: `/final-artwork.html`

## Next Drive (Recommended)
1. Decide live presence model:
   - Keep current signed websocket seeding.
   - Or add delegated seeding permits for smoother participation.
2. Improve final artwork renderer:
   - Keep strict 10x10 compilation, then add approved deterministic transforms only if desired.
3. Production hardening:
   - Hosted websocket infra + observability + restart policy.
   - Rate limiting and anti-spam protections.
4. Contract-level round model decision:
   - Keep persistent 100 nodes per round, or design v9 with remint/reset semantics.

## Security Notes
- No private keys or mnemonics are stored in tracked files.
- `.env*` is gitignored.
- `instructions.md` and `codex.md` are local-only (gitignored).
