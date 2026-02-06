# Pixel2Pixel v6 App

## Version Summary
- Kept v5 visual branding and layout.
- Replaced dummy/offline color grid with on-chain NFT SVG rendering.
- Enforced seeding-only render behavior:
- No seeding: blank grid.
- Seeding active: node SVG appears from on-chain `tokenURI`.
- Added WS auth flow with wallet signature and server-side `nodeOf(address)` validation.
