# Warranty Passport Security and Requirements Audit

Date: 2026-07-05

## Decision

The hardened contracts are deployed to Sepolia and verified as Exact Match. All demo IPFS references are pinned and publicly retrievable from Filebase. The Vercel frontend and Render API are public, live X402 settlement is recorded, and a phone QR test is preserved. All project release gates are complete. No audit can guarantee that a contract is impossible to hack. This assessment is suitable for a student testnet demonstration, not for custody of real-value assets.

Current Sepolia addresses:

- WarrantyManager: `0x2232c9bf2f106008fb0f0a4a4c395c7ea3f4aa61`
- WarrantyNFT: `0xd12d2e9d46ee4c9905aaff9573ae90bf98b78cd2`
- WarrantyToken: `0xdb27f9a0152180dbd53832f491c68badbe58e339`

## Requirements matrix

| Requirement | Code status | Production evidence required |
| --- | --- | --- |
| Product registration and NFT mint | Complete | Four products registered on Sepolia |
| ERC20 fees/rewards and 10% creator fee | Complete | iPhone transfer verified |
| Permanent IPFS | Complete | 13 on-chain references returned HTTP 200 |
| Standard NFT metadata JSON | Complete | Four metadata/image pairs pinned |
| Ownership/document/service/status histories | Complete | Paginated getters and UI records |
| Service Record with IPFS | Complete | MacBook inspection record on-chain |
| Lost/Stolen warning | Complete | Electric Bicycle marked Lost |
| Public page and QR | Complete | Phone camera opened the Electric Bicycle page without MetaMask |
| All products / My products | Complete | Filter and frontend test |
| Wallet-authorized upload | Complete | Signature challenge and backend tests |
| Live X402 report | Complete | Base Sepolia USDC settlement and proof verified |
| Exact Match verification | Complete | All three Etherscan pages confirmed |
| Vercel/Render deployment | Complete | Public frontend and API verified |

## Security controls

- Direct and operator ERC721 transfers revert, preventing history bypass.
- NFT manager assignment is one-time and deployment removes deployer token admin/minter roles.
- WTY supply is capped; serials are unique; category, IPFS URIs, dates, service descriptions and positive prices are validated.
- State updates precede external safe NFT transfer and rejecting receivers roll back the operation.
- Upload requires a fresh single-use EIP-191 signature, expires after five minutes, is rate-limited and capped at 20 MB.
- Render no longer stores IPFS blocks on ephemeral disk. Uploads pin directly through Filebase RPC.
- Frontend and backend retry transient Sepolia RPC reads three times.
- X402 uses Base Sepolia USDC and downloads settlement evidence with transaction hash.
- History APIs enforce page sizes from 1 to 100. Legacy full-array getters remain for compatibility.

## Automated verification

- Solidity 0.8.28 with optimizer and `viaIR`: compiled.
- Contract tests: 18 passed.
- Backend tests: 7 passed.
- Frontend tests: 5 passed.
- Production frontend build: passed.
- Rerun `npm audit` immediately before submission.

## Residual risks

1. One owner wallet controls registration and administrative statuses. Keep it testnet-only.
2. The seller declares transfer price. The royalty cannot prove an off-chain payment amount.
3. Exact Match depends on deployment compiler settings and generated constructor arguments.
4. Filebase, Render, Vercel, public RPC and facilitator are external dependencies.
5. High-volume indexers should use bounded page getters, not compatibility full-array getters.

## Release gate

- New `contracts/deployments/11155111.json`: complete.
- Three Etherscan **Exact Match** pages: complete.
- Successful `npm run check:cids`, including `PA_102` and service CID: complete.
- Render `/health` showing Filebase and live X402: complete.
- X402 proof JSON and Base Sepolia transaction hash: complete.
- Phone screenshot of the QR-opened Lost product page: complete.

Verified X402 settlement:

- Product: iPhone 15 (`productId=1`)
- Network: Base Sepolia (`84532`)
- Amount: `0.001 USDC`
- Payer: `0x300f746efD00294c7C3c5814D54bC6FE3CA2bd42`
- Recipient: `0x34a6746F8BC407A98957cdF565dCEDDca5420E77`
- Transaction: `0x43504eaa8b54f2fa3c7233018a137dde9ca76896155c0c7ede86a7db736969f9`
- Proof file: `evidence/x402-product-1-payment-proof.json`

Verified QR test:

- Device: phone camera and mobile browser, without MetaMask
- Product: Electric Bicycle (`EBIKE-DEMO-003`)
- Public warning: `PROBLEMATIC` / `LOST`
- Evidence file: `evidence/qr-electric-bicycle-phone.png`
