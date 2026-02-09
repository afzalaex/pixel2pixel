# Pixel2Pixel v7 App

## Version Summary
- Canvas is fixed `10 x 10` and renders node SVG only while that node is actively seeded.
- Seeding is strictly off-chain and toggles SVG visibility on/off (no SVG mutation, no invented pixels).
- Terminal state freezes seeding at:
  - `totalSupply == 100`
  - `activeSeeders == 100`
- Terminal snapshot is generated server-side with:
  - block number
  - timestamp
  - active node list
  - deterministic seed hash
- Deterministic client-side shuffle is applied only after auction finalization.
- Off-chain seeding resets when `NodesV7.resetGame()` increments `roundId`.

## Runtime
```bash
npm install
npm start
```

## Basic UI Simulation
- Open `http://localhost:8080/?testingMode=1`
- Use controls to simulate `minted` and `seeded` counts without wallet actions.

## Required Config
Update `contract-config.json` with deployed:
- `nodes.address`
- `finalAuction.address` (optional but required for shuffle-ready detection)
