## Pixel2Pixel

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

### v7 Lock
v7 is locked. Any new feature work starts in v8.

### v8 Rehearsal Quick Steps
Path: `v8/v8-contracts`

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

### v8 UI Rehearsal (recommended for final flow)
Path: `v8/v8-app`

1. Run app server:
```bash
npm install
npm start
```
2. Use:
   - `/` for mint + seeding terminal
   - `/auction.html` for activate/bid/finalize/claim/reset
   - `/final-artwork.html` to verify minted 1/1 tokenURI + SVG
3. For rehearsal wallets derived from mnemonic, run:
```bash
cd v8/v8-app
npm run rehearsal:seed-all
```
4. Stop all seeded rehearsal sessions:
```bash
cd v8/v8-app
npm run rehearsal:seed-all:stop
```

### v8 Handoff
- Current execution handoff: `v8/HANDOFF.md`

### Secrets Policy
- Never commit `.env` or `.env.*` files.
- Never paste private keys or seed phrases.
