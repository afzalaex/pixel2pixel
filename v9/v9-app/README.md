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

## Local Run

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

## Environment (optional)

- `VITE_API_BASE_URL` (default `http://localhost:8080`)
- `VITE_SEPOLIA_RPC` (default `https://ethereum-sepolia-rpc.publicnode.com`)
- `VITE_WALLETCONNECT_PROJECT_ID` (recommended for full wallet modal support)

## Rehearsal Seeder Helper

```bash
npm run rehearsal:seed-all
npm run rehearsal:seed-all:stop
```

## Notes

- Seeding remains off-chain via signed websocket auth.
- No contract changes were introduced.
- Pattern preview logic is modularized under `src/patterns/` and used internally (no UI selector in production routes).
