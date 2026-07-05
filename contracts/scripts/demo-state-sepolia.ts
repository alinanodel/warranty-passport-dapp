import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { network } from "hardhat";
import { getAddress } from "viem";

const systemConfig = JSON.parse(
  await readFile(new URL("../../frontend/src/contracts/WarrantySystem.json", import.meta.url), "utf8"),
);
const demoAssets = JSON.parse(
  await readFile(new URL("../../services/demo-assets.json", import.meta.url), "utf8"),
) as Array<{ serviceDocumentUri?: string }>;
const managerAddress = getAddress(systemConfig.contracts.manager.address);
const serviceDocumentUri = demoAssets[1]?.serviceDocumentUri;
if (!serviceDocumentUri?.startsWith("ipfs://")) {
  throw new Error("Pin the demo service document first");
}

const { viem } = await network.create();
const [owner] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const manager = await viem.getContractAt("WarrantyManager", managerAddress);

assert.equal(await publicClient.getChainId(), 11155111);
assert.equal(await manager.read.owner(), getAddress(owner.account.address));

if ((await manager.read.getServiceHistory([2n])).length === 0) {
  const serviceHash = await manager.write.addServiceRecord([
    2n,
    "Inspection",
    "Annual hardware inspection completed; battery and display passed diagnostics.",
    serviceDocumentUri,
    (await publicClient.getBlock()).timestamp,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: serviceHash });
}

const bicycle = await manager.read.getProduct([3n]);
if (bicycle.safetyStatus !== 1) {
  const lostHash = await manager.write.setSafetyStatus([3n, 1]);
  await publicClient.waitForTransactionReceipt({ hash: lostHash });
}

assert.equal((await manager.read.getServiceHistory([2n])).length, 1);
assert.equal((await manager.read.getProduct([3n])).safetyStatus, 1);
console.log("Demo service record and Lost warning verified successfully.");
