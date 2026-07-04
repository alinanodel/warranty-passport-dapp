import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const systemConfig = JSON.parse(
  await readFile(
    new URL("../../frontend/src/contracts/WarrantySystem.json", import.meta.url),
    "utf8",
  ),
);
const MANAGER_ADDRESS = getAddress(systemConfig.contracts.manager.address);
const TOKEN_ADDRESS = getAddress(systemConfig.contracts.token.address);

const { viem } = await network.create();
const [registrar] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const manager = await viem.getContractAt("WarrantyManager", MANAGER_ADDRESS);
const token = await viem.getContractAt("WarrantyToken", TOKEN_ADDRESS);

assert.equal(await publicClient.getChainId(), 11155111);
assert.equal(await manager.read.owner(), getAddress(registrar.account.address));
assert.equal(
  await manager.read.totalProducts(),
  0n,
  "Demo products already exist; refusing to seed twice",
);

const products = [
  {
    name: "iPhone 15",
    category: "Phone",
    serialNumber: "IPH15-DEMO-001",
    price: parseEther("800"),
    ipfsUri: "ipfs://QmPaAWVPaCpV4XsZ4qv7ZcSw9purkCcYyGLNSkLfog8Udo",
  },
  {
    name: "MacBook Air",
    category: "Computer",
    serialNumber: "MBA-DEMO-002",
    price: parseEther("1200"),
    ipfsUri: "ipfs://QmbJJziDVx658hVHSDd5DWxhEtJSah9KKZ449DfKToWmxc",
  },
  {
    name: "Electric Bicycle",
    category: "Mobility",
    serialNumber: "EBIKE-DEMO-003",
    price: parseEther("1800"),
    ipfsUri: "ipfs://QmREaaPm86gARMVgtUFNZ8B89wG8Mr1qCdGBbeF8oG5dF3",
  },
] as const;

const registrationFee = await manager.read.registrationFee();
const approveHash = await token.write.approve([
  MANAGER_ADDRESS,
  registrationFee * BigInt(products.length),
]);
await publicClient.waitForTransactionReceipt({ hash: approveHash });

const purchaseDate = (await publicClient.getBlock()).timestamp;
for (const product of products) {
  console.log(`Registering ${product.name}...`);
  const hash = await manager.write.registerProduct([
    product.name,
    product.category,
    product.serialNumber,
    purchaseDate,
    365n * 86_400n,
    product.price,
    product.ipfsUri,
    registrar.account.address,
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
}

assert.equal(await manager.read.totalProducts(), 3n);
console.log("Sepolia demo products registered and verified successfully.");
