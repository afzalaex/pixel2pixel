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
