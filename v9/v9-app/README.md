# Pixel2Pixel v9 App

v9 keeps all v8 mechanics and contracts unchanged, and upgrades frontend architecture to:

- React (Vite)
- wagmi + viem
- RainbowKit
- React Router (`/`, `/auction`, `/final`)

## Contracts (Sepolia, inherited from v8)
- NodesV8: `0x9459D54c0D8A80ae7C71AcdE5f7bFD61F54ab266`
- FinalAuction: `0xDbaEC79042FA742812DAecEf530bF892b201a59E`
- FinalArtwork: `0x35f21738e17cC01cF59892Fa67bEaEB23D514DeA`

## Prerequisites
- Node.js 20+
- Sepolia wallet in browser
- v9 contracts deployed and `contract-config.json` addresses set correctly

## Local Run (Two Terminals)

1. Install dependencies:
```bash
npm install
```

2. Start backend (Express + WS, unchanged mechanics):
```bash
npm start
```

3. In another terminal, start React frontend:
```bash
npm run dev
```

4. Open:
- `http://localhost:5173/` canvas
- `http://localhost:5173/auction` auction
- `http://localhost:5173/final` final artwork

## Environment

- `VITE_API_BASE_URL` (optional; default uses local backend/proxy)
- `VITE_SEPOLIA_RPC` (optional; default `https://ethereum-sepolia-rpc.publicnode.com`)
- `VITE_WALLETCONNECT_PROJECT_ID` (recommended for full wallet modal support)

## Rehearsal Seeder Helper

From `v9/v9-app`:
```bash
npm run rehearsal:seed-all
npm run rehearsal:seed-all:stop
```

Helper envs:
- `REHEARSAL_MNEMONIC` or `SEED_MNEMONIC`
- `SEED_COUNT` (default `100`)
- `SEED_HOLD_SECONDS` (default `180`, `0` for hold-until-stop)
- `SEED_SERVER_URL` (default `http://localhost:8080`)
- `SEED_WS_URL` (optional explicit websocket URL)

## v9 Rehearsal Runbook (End-to-End)
1. Start backend (`npm start`) and frontend (`npm run dev`).
2. Open `/` and mint toward `100/100`.
3. Keep nodes seeded (manual wallets or `npm run rehearsal:seed-all`) until terminal lock.
4. Open `/auction`; verify terminal snapshot hash and auction state.
5. Activate auction with duration.
6. Place bids from node-owner wallets.
7. Finalize auction after end time.
8. Winner clicks Claim Final Artwork.
9. Reset round.
10. Open `/final` and verify round/token/owner/snapshot metadata + SVG.

## Expected Route Behavior
- `/`: mint + seeding + live canvas state
- `/auction`: activate/bid/finalize/withdraw/claim/reset controls
- `/final`: final NFT lookup by round and latest minted lookup

## Notes

- Seeding remains off-chain via signed websocket auth.
- No contract changes were introduced.
- Pattern preview logic is modularized under `src/patterns/` and used internally (no UI selector in production routes).
