# Pixel2Pixel v6 Contracts

This folder contains the v6 ERC721 contract for Pixel2Pixel.

## Implemented contract scope
- Max supply: `100`
- One mint per wallet
- `nodeOf(address)` returns `tokenId` or `0`
- Deterministic on-chain SVG per token
- `tokenURI` returns base64 JSON with base64 SVG image

## Private local file (do not commit)
Create `v6/v6-contracts/.env`:

```env
SEPOLIA_RPC=https://sepolia.infura.io/v3/your_key
PRIVATE_KEY=0xyour_private_key_without_quotes
```

`.env` is already ignored by git via `.gitignore`.

## Commands
```bash
npm install
npm run compile
npm test
npm run deploy:sepolia
```

## Deployment notes
- You run deployment locally with your private key in `.env`.
- The deploy script logs contract address after successful deployment.
- Save that address for v6 frontend integration.

## Deployed address
- Network: `Sepolia`
- Contract: `Nodes`
- Address: `0x481d7c71c4f717b93386A47106788F6b21bF2B39`

## Gas profile verification
Your reported numbers match the local v6 test profile:
- `mint`: `121,179`
- `transferFrom`: `78,759`
- deployment: `2,975,236`
