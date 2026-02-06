# Pixel2Pixel v6 App

## Behavior
- Same visual branding as v5.
- Canvas renders on-chain NFT SVG only (`tokenURI` -> decode SVG -> render).
- No seeding = blank grid.
- Seeding active = render seeded nodes from on-chain SVG.
- WS seeding is wallet-signed and server-validated against on-chain `nodeOf(address)`.

## Run
```bash
npm install
npm start
```

Then open `http://localhost:8080`.

## Optional server env
- `SEPOLIA_RPC` (recommended for WS seeding ownership checks)
- `PORT` (default `8080`)
