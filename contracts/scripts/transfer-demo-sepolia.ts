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
const BUYER_ADDRESS = getAddress("0x300f746efD00294c7C3c5814D54bC6FE3CA2bd42");
const PRODUCT_ID = 1n;
const SALE_PRICE = parseEther("100");

const { viem } = await network.create();
const [seller] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const manager = await viem.getContractAt("WarrantyManager", MANAGER_ADDRESS);
const token = await viem.getContractAt("WarrantyToken", TOKEN_ADDRESS);

assert.equal(await publicClient.getChainId(), 11155111);
const productBefore = await manager.read.getProduct([PRODUCT_ID]);
assert.equal(productBefore.currentOwner, getAddress(seller.account.address));
assert.equal((await manager.read.getOwnershipHistory([PRODUCT_ID])).length, 1);

const royalty = (SALE_PRICE * 1_000n) / 10_000n;
const requiredAllowance = (await manager.read.transferFee()) + royalty;
const approveHash = await token.write.approve([
  MANAGER_ADDRESS,
  requiredAllowance,
]);
await publicClient.waitForTransactionReceipt({ hash: approveHash });

const transferHash = await manager.write.transferOwnership([
  PRODUCT_ID,
  BUYER_ADDRESS,
  SALE_PRICE,
]);
await publicClient.waitForTransactionReceipt({ hash: transferHash });

const productAfter = await manager.read.getProduct([PRODUCT_ID]);
const history = await manager.read.getOwnershipHistory([PRODUCT_ID]);
assert.equal(productAfter.currentOwner, BUYER_ADDRESS);
assert.equal(history.length, 2);
assert.equal(history[1].owner, BUYER_ADDRESS);
assert.equal(history[1].transferPrice, SALE_PRICE);

console.log("iPhone 15 transferred and ownership history verified successfully.");
