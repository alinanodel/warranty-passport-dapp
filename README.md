# Warranty Passport Dapp

Digital warranty passports for valuable physical products. Each product has an NFT, IPFS documents, warranty and service status, and an immutable ownership history.

## Architecture

- `contracts/contracts/WarrantyNFT.sol`: ERC721 warranty passport NFT.
- `contracts/contracts/WarrantyToken.sol`: ERC20 `WTY` fee and reward token.
- `contracts/contracts/WarrantyManager.sol`: products, fees, transfers, documents, warranty, safety and histories.
- `frontend`: React Dashboard, MetaMask, public product verification and QR.
- `services`: persistent Helia IPFS node and X402-protected report API.

## Requirements coverage

- Admin product registration with all required fields and IPFS URI.
- Warranty NFT minting for each product.
- Real file upload to Helia IPFS and retrieval by CID.
- Ownership transfer with date, price and 10% creator fee.
- ERC20 registration fee, transfer fee and registration reward.
- Active, expired, transferred and problematic warranty states.
- Service and repair history with IPFS attachments.
- Lost and stolen product warnings.
- Stored owner, price, date, document, service and warranty status histories.
- X402 HTTP `402 Payment Required` endpoint for extended reports.
- QR code for every public product verification page.
- MetaMask Dashboard with product, transfer, IPFS and status actions.
- Required Solidity events: `ProductRegistered`, `OwnershipTransferred`, `ServiceRecordAdded`, `WarrantyStatusChanged`, `DocumentAdded`.
- Three demo products: iPhone 15, MacBook Air and Electric Bicycle.
- Local Hardhat network and Sepolia deployment configuration.
- Web3.js network verification and Viem contract interactions.

## Local demo

Run each command in a separate terminal.

```bash
cd contracts
npm run node
```

```bash
cd contracts
CONTRACT_OWNER=0xYOUR_METAMASK_ADDRESS npm run deploy:localhost
```

```bash
cd services
npm run dev
```

```bash
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173` in Chrome with MetaMask.

## Sepolia

Copy `contracts/.env.example` values into your environment and run:

```bash
npm run deploy:sepolia
```

Sepolia deployment requires a funded test wallet and an RPC URL. Never commit a private key.

## X402

Local mode returns a standards-shaped X402 v2 challenge for Base Sepolia USDC. For live facilitator verification and settlement:

```bash
cd services
X402_LIVE=true X402_PAY_TO=0xYOUR_PUBLIC_ADDRESS npm run dev
```

Live payment requires Base Sepolia test USDC and network access to the configured facilitator.

## Verification

```bash
cd contracts && npm test
cd frontend && npm run build
```

## Known Bugs / external prerequisites

- Live X402 settlement depends on facilitator network access and Base Sepolia test USDC.
- Sepolia deployment depends on user-provided RPC credentials and test ETH.
- Local IPFS content is persistent on this computer; public availability requires pinning or hosting the Helia node.
