# Warranty Passport Dapp

A public Web3 warranty passport for physical products. Each product is represented by an ERC721 NFT and has permanent Filebase/IPFS documents, ERC20 fees and rewards, ownership history, service records, safety warnings, QR verification and an X402-paid extended report.

## Public services

- Frontend: <https://warranty-passport-dapp.vercel.app>
- API: <https://warranty-passport-dapp.onrender.com>
- Contracts: Ethereum Sepolia (`11155111`)
- X402 payment: Base Sepolia (`84532`), test USDC
- IPFS pinning and gateway: Filebase

The authoritative contract addresses and ABIs are stored in `frontend/src/contracts/WarrantySystem.json`. Deployment constructor arguments are stored in `contracts/deployments/11155111.json`. Never copy addresses manually between files.

### Current Sepolia contracts

- WarrantyManager: [`0x2232c9bf2f106008fb0f0a4a4c395c7ea3f4aa61`](https://sepolia.etherscan.io/address/0x2232c9bf2f106008fb0f0a4a4c395c7ea3f4aa61#code)
- WarrantyNFT: [`0xd12d2e9d46ee4c9905aaff9573ae90bf98b78cd2`](https://sepolia.etherscan.io/address/0xd12d2e9d46ee4c9905aaff9573ae90bf98b78cd2#code)
- WarrantyToken: [`0xdb27f9a0152180dbd53832f491c68badbe58e339`](https://sepolia.etherscan.io/address/0xdb27f9a0152180dbd53832f491c68badbe58e339#code)

All three contracts are verified as **Exact Match**.

## Architecture

- `WarrantyNFT.sol`: NFT transfers must pass through the manager so ownership history cannot be bypassed.
- `WarrantyToken.sol`: capped ERC20 WTY token for fees and rewards.
- `WarrantyManager.sol`: registration, transfer, 10% creator royalty, documents, service records, statuses and paginated histories.
- `frontend`: React/Vite dashboard, MetaMask, All/My filter, public route, QR and X402 client.
- `services`: wallet-authorized Filebase uploads, ERC721 metadata generation and X402 report API.

## Implemented requirements

- Four demo products: iPhone 15, MacBook Air, Electric Bicycle and Pictorial Art (`PA_102`).
- Separate warranty document and standards-compatible NFT metadata JSON in IPFS.
- Automatic Filebase pinning for every document, passport image and metadata file.
- Ownership, service, document and status histories with bounded pagination APIs.
- Lost/Stolen public warnings and an IPFS-backed service record demo.
- Public QR verification without MetaMask.
- Wallet-signed upload authorization, upload limits and Sepolia RPC retry.
- Live X402 middleware for a `$0.001` Base Sepolia USDC report.
- Downloadable X402 payment proof containing the settlement transaction hash.

## Verification

```bash
cd contracts && npm test
cd ../services && npm test
cd ../frontend && npm test && npm run build
```

Expected result: 18 contract tests, 7 backend tests and 5 frontend tests pass, followed by a successful production build.

## Release order

Do not push the frontend before completing steps 1-4 because it uses the new `WarrantyManager` ABI.

1. Store secrets locally without sending them in chat:

```bash
cd contracts
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

2. Pin demo assets:

```bash
cd services
FILEBASE_RPC_TOKEN='YOUR_TOKEN' npm run pin:demo
```

3. Deploy, verify and prepare Sepolia:

```bash
cd contracts
npm run deploy:sepolia
npm run verify:sepolia
npm run seed:sepolia
npm run demo-state:sepolia
npm run transfer-demo:sepolia
```

4. Verify every on-chain CID:

```bash
cd services
npm run check:cids
```

5. In Render set `FILEBASE_RPC_TOKEN`, `SEPOLIA_RPC_URL`, `X402_LIVE=true`, `X402_PAY_TO` and the Vercel `CORS_ORIGIN`, then deploy. `/health` must report `ipfs: "filebase"` and `liveX402: true`.

6. Commit and push after the new contract JSON is generated. Vercel deploys from GitHub.

7. Fund the paying wallet with Base Sepolia test USDC, use **Buy extended X402 report**, approve in MetaMask, download the proof JSON and preserve its transaction hash.

8. Scan a product QR with a phone without MetaMask. Confirm the page opens and the Electric Bicycle Lost warning is visible.

## Environment variables

See `contracts/.env.example` and `services/.env.example`. Secrets belong in Hardhat keystore, Render or the provider dashboard. Never commit a private key, Filebase token or Etherscan key.

## Security scope

This is a hardened student testnet project, not a professional audit for real-value custody. The seller declares the transfer price, so the 10% royalty is enforced on the declared value. An atomic marketplace contract is intentionally outside the required scope.
