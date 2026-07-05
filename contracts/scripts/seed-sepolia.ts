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

const demoAssets = JSON.parse(
  await readFile(new URL("../../services/demo-assets.json", import.meta.url), "utf8"),
) as Array<{
  name: string;
  category: string;
  serialNumber: string;
  price: string;
  documentUri: string;
  metadataUri: string;
}>;
assert.equal(demoAssets.length, 4, "Pin all four demo products before seeding");
const products = demoAssets.map((product) => ({ ...product, price: parseEther(product.price) }));

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
    product.documentUri,
    product.metadataUri,
    registrar.account.address,
  ]);
  await publicClient.waitForTransactionReceipt({ hash });
}

assert.equal(await manager.read.totalProducts(), 4n);
console.log("Sepolia demo products registered and verified successfully.");
