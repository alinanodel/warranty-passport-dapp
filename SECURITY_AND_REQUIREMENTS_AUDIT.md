# Warranty Passport Security and Requirements Audit

Date: 2026-07-04

## Publication decision

The patched contracts are deployed to Sepolia and the frontend points to their
verified addresses. The Solidity system is suitable for a student testnet demo.
Public release is still blocked on public IPFS/service hosting, live X402
settlement, and external-device QR verification.

No audit can prove that a contract is impossible to hack. This review combines
manual analysis, automated tests, Slither static analysis, and dependency audits.
It is appropriate for a student testnet project, not a substitute for an
independent professional audit of contracts that hold real value.

## Requirements matrix

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Product registration with required fields | Complete | `WarrantyManager.registerProduct` and React form |
| NFT for every product | Complete | `WarrantyNFT.mintPassport` |
| IPFS warranty and additional documents | Partial | Upload, retrieval and on-chain URIs work; public pinning/hosting is missing |
| Ownership transfer, date, owner and price | Complete | Contract, history, event and UI are implemented |
| 10% creator fee | Partial | Enforced on declared price, but the seller declares the price and pays the fee |
| ERC20 used for fees or rewards | Complete | Registration fee, transfer fee and registration reward use WTY |
| Warranty validity | Complete | Active and expired states use purchase date and warranty period |
| Active, expired, transferred, problematic | Complete | Contract and UI support all required states |
| Service history with IPFS and date | Complete | Contract and UI are implemented |
| Lost/stolen warning | Complete | Safety status is stored and displayed |
| Accumulated histories | Complete | Owner, service, document and status histories are retained |
| Actual X402 payment | Partial | HTTP 402, live middleware and a real Sepolia product report exist; settlement with Base Sepolia USDC has not been executed |
| QR public verification | Partial | QR and public route exist; permanent public hosting is missing |
| MetaMask dashboard and owner actions | Complete | Connection, account switch, details and actions are implemented |
| Three separate required contracts | Complete | WarrantyNFT, WarrantyToken and WarrantyManager |
| Required Solidity events | Complete | All five required event types are emitted |
| Three required demo products | Complete | iPhone 15, MacBook Air and Electric Bicycle are registered in Sepolia |
| Sepolia deployment | Complete | Patched contracts, roles, treasury and frontend configuration are verified |

Estimated strict requirements completion: about 92%. Public, independently
usable deployment readiness: about 82%.

## Security fixes applied

- Direct ERC721 transfers now revert, so NFT ownership cannot bypass
  `WarrantyManager` or corrupt ownership history.
- The NFT manager can only be configured once.
- Manager transfers use safe ERC721 delivery.
- WTY has a hard maximum supply.
- The deployment script removes deployer minter and default-admin roles after
  granting the immutable manager its role.
- Duplicate serial numbers are rejected.
- Product and service dates and IPFS URI prefixes are validated.
- Zero-price ownership transfers are rejected.
- State is updated before the external NFT transfer.
- A separate fee-recipient setting is available for deployment.
- Frontend and backend service URLs are environment-configurable.
- IPFS uploads have a 20 MB limit and a basic per-IP hourly rate limit.
- The paid X402 handler builds its report from current Sepolia product,
  ownership, service, document and status data.

## Verification performed

- Hardhat compile with Solidity 0.8.28: passed.
- Contract tests: 17 passed.
- Exploit regression tests: direct NFT transfer, manager replacement, duplicate
  serial, invalid IPFS, zero-price transfer, approved-operator bypass,
  rejecting-receiver rollback, former-owner access and supply-cap checks passed.
- Slither: 30 contracts and 101 detectors analyzed. No high/medium project-code
  finding remained. Expected informational findings concern timestamps and a
  benign callback during safe minting.
- Runtime dependency audit: zero known vulnerabilities in contracts, frontend
  and services.
- Production frontend build: passed.
- NFT and Token Sepolia bytecode exactly match local artifacts. Manager bytecode
  matches after normalizing compiler-injected immutable addresses.
- Sepolia simulations confirmed that direct NFT transfer and manager replacement
  attacks revert.
- Three demo CIDs returned HTTP 200. Service health returned HTTP 200 and the
  X402 endpoint returned a standards-shaped HTTP 402 challenge.
- The extended report builder returned current iPhone 15 data, two ownership
  records and its document list from Sepolia.

## Residual risks before publication

1. A single owner wallet controls registration, fees and administrative status
   changes. Use a dedicated test wallet and never expose its private key.
2. The transfer price is self-reported. A buyer-acceptance sale flow is needed
   if the 10% fee must be economically tamper-resistant.
3. `tokenURI` points to a document rather than ERC721 metadata JSON. The NFT is
   valid but may not render correctly in marketplaces.
4. Full-array history reads and owner-product scans are not paginated and can
   become expensive at large scale.
5. The public IPFS upload service has basic rate limiting but still needs wallet
   authorization before accepting untrusted internet uploads.
6. IPFS content must be pinned on a public provider or a continuously running
   public node.
7. X402 must be tested with live facilitator settlement and Base Sepolia USDC.
8. A previous long-running local Helia process became unresponsive at 100% CPU.
   Public hosting needs automatic restart/health supervision.
9. The dashboard identifies owned products but still lists every public product.
   Add an explicit "My products" filter if the requirement is graded literally.

## Required release gate

1. Pin all referenced CIDs publicly.
2. Host the services securely and enable/test live X402.
3. Deploy the frontend and test the QR URL from another device without localhost.
