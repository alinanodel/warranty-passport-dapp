# Warranty Passport contracts

Run `npm test` before deployment. Sepolia deployment writes both the frontend ABI/address file and `deployments/11155111.json`; verification reads that manifest, so no address should be copied manually.

```bash
npm run deploy:sepolia
npm run verify:sepolia
npm run seed:sepolia
npm run demo-state:sepolia
```

Store the configuration variables listed in `.env.example` with:

```bash
npx hardhat keystore set VARIABLE_NAME
```
