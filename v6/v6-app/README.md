# Pixel2Pixel v6 App

## Behavior
- Same visual branding as v5.
- Canvas rendering is on-chain NFT SVG only (`tokenURI` -> decode SVG -> render).
- WebSocket is used only for seeding overlay state.
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
