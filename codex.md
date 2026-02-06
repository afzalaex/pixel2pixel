\# Pixel2Pixel – Codex State (v6)



\## What this project is

Pixel2Pixel is a 100-node generative artwork.



Each node:

\- Is an ERC721 NFT

\- Mints exactly once per wallet

\- Has a deterministic on-chain SVG pixel

\- Maps 1:1 to a fixed position on a 10x10 canvas



The canvas must ALWAYS render the NFT SVG.

No mock colors. No placeholders. No WS-generated pixels.



\## Current status (end of v5)

\- v5 contract on Sepolia supports minting

\- Frontend + WebSocket seeding exists

\- Canvas bugs occurred due to mixed sources of truth



\## v6 goals (do not exceed scope)

1\. New ERC721 contract:

&nbsp;  - Max supply: 100

&nbsp;  - One mint per wallet

&nbsp;  - On-chain SVG pixel (deterministic color)

&nbsp;  - SVG must render correctly in:

&nbsp;    - MetaMask

&nbsp;    - Etherscan

&nbsp;    - OpenSea

&nbsp;  - `nodeOf(address)` returns tokenId or 0



2\. Frontend:

&nbsp;  - Wallet connect

&nbsp;  - Mint button

&nbsp;  - After mint:

&nbsp;    - Fetch tokenURI

&nbsp;    - Decode SVG

&nbsp;    - Render SVG into correct grid cell

&nbsp;  - Canvas has NO gaps

&nbsp;  - Canvas pixels come ONLY from tokenURI SVG



3\. Seeding (v6 rules):

&nbsp;  - Seeding is OFF-CHAIN (WebSocket)

&nbsp;  - Seeding never changes SVG

&nbsp;  - Seeding only adds visual overlay (border/glow/opacity)

&nbsp;  - WS must not invent nodes



\## Explicitly forbidden

\- No mock NFTs

\- No placeholder pixels

\- No canvas colors not derived from SVG

\- No on-chain seeding

\- No extra mechanics



\## Design

\- Same visual language as v5

\- Black background

\- Minimal UI

\- No extra UI experiments



