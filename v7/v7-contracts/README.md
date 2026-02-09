# Pixel2Pixel v7 Contracts

## Contracts
- `NodesV7`:
  - ERC721 nodes with deterministic on-chain SVG.
  - SVG output is full-bleed per token (no inner padding) to avoid tile seam artifacts.
  - `MAX_SUPPLY = 100`.
  - One mint per wallet (`_hasMinted` + `nodeOf` sync).
  - `gameActive` flips to `true` automatically when token `#100` is minted.
  - `resetGame()` (owner) sets `gameActive = false` and increments `roundId` for the next round cycle.
- `FinalAuction`:
  - Separate auction contract activated with terminal snapshot hash.
  - Only current node owners can bid in ETH.
  - Mints exactly one final 1/1 NFT to auction winner.

## Local Commands
```bash
npm install
npm run compile
npm test
npm run deploy:sepolia
```

## Deployment Output
- Deploy script writes `deployments/<network>.json` with both:
  - `nodesV7.address`
  - `finalAuction.address`
