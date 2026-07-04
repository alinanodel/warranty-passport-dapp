import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const systemOwner = getAddress(
  process.env.CONTRACT_OWNER ?? deployer.account.address,
);
const seedDemo = process.env.SEED_DEMO !== "false";
const feeRecipient = getAddress(
  process.env.FEE_RECIPIENT ?? systemOwner,
);

const registrationFee = parseEther("10");
const transferFee = parseEther("5");
const registrationReward = parseEther("20");

console.log("Deploying Warranty Passport system...");
console.log("Deployer:", deployer.account.address);
console.log("System owner:", systemOwner);

const token = await viem.deployContract("WarrantyToken", [
  deployer.account.address,
  parseEther("1000000"),
]);
const nft = await viem.deployContract("WarrantyNFT", [deployer.account.address]);
const manager = await viem.deployContract("WarrantyManager", [
  deployer.account.address,
  nft.address,
  token.address,
  feeRecipient,
  registrationFee,
  transferFee,
  registrationReward,
]);

const setManagerHash = await nft.write.setManager([manager.address]);
await publicClient.waitForTransactionReceipt({ hash: setManagerHash });
const grantMinterHash = await token.write.grantRole([
  await token.read.MINTER_ROLE(),
  manager.address,
]);
await publicClient.waitForTransactionReceipt({ hash: grantMinterHash });

const demoProducts = [
  {
    name: "iPhone 15",
    category: "Phone",
    serialNumber: "IPH15-DEMO-001",
    price: parseEther("800"),
    ipfsHash: "ipfs://QmPaAWVPaCpV4XsZ4qv7ZcSw9purkCcYyGLNSkLfog8Udo",
  },
  {
    name: "MacBook Air",
    category: "Computer",
    serialNumber: "MBA-DEMO-002",
    price: parseEther("1200"),
    ipfsHash: "ipfs://QmbJJziDVx658hVHSDd5DWxhEtJSah9KKZ449DfKToWmxc",
  },
  {
    name: "Electric Bicycle",
    category: "Mobility",
    serialNumber: "EBIKE-DEMO-003",
    price: parseEther("1800"),
    ipfsHash: "ipfs://QmREaaPm86gARMVgtUFNZ8B89wG8Mr1qCdGBbeF8oG5dF3",
  },
] as const;

if (seedDemo) {
  const approveHash = await token.write.approve([
    manager.address,
    registrationFee * BigInt(demoProducts.length),
  ]);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  const now = (await publicClient.getBlock()).timestamp;

  for (const product of demoProducts) {
    const registrationHash = await manager.write.registerProduct([
      product.name,
      product.category,
      product.serialNumber,
      now,
      365n * 86_400n,
      product.price,
      product.ipfsHash,
      systemOwner,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: registrationHash });
  }
}

if (systemOwner !== getAddress(deployer.account.address)) {
  const fundingHash = await deployer.sendTransaction({
    to: systemOwner,
    value: parseEther("100"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundingHash });

  const tokenTransferHash = await token.write.transfer([
    systemOwner,
    parseEther("10000"),
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tokenTransferHash });

  const managerOwnershipHash = await manager.write.transferOwnership([systemOwner]);
  await publicClient.waitForTransactionReceipt({ hash: managerOwnershipHash });

  const nftOwnershipHash = await nft.write.transferOwnership([systemOwner]);
  await publicClient.waitForTransactionReceipt({ hash: nftOwnershipHash });
}

const minterRole = await token.read.MINTER_ROLE();
const adminRole = await token.read.DEFAULT_ADMIN_ROLE();
const minterRenounceHash = await token.write.renounceRole([
  minterRole,
  deployer.account.address,
]);
await publicClient.waitForTransactionReceipt({ hash: minterRenounceHash });

const adminRenounceHash = await token.write.renounceRole(
  [adminRole, deployer.account.address],
  { gas: 100_000n },
);
await publicClient.waitForTransactionReceipt({ hash: adminRenounceHash });

assert.equal(await manager.read.owner(), systemOwner);
assert.equal(await nft.read.manager(), getAddress(manager.address));
assert.equal(await token.read.hasRole([minterRole, manager.address]), true);
assert.equal(await token.read.hasRole([minterRole, deployer.account.address]), false);
assert.equal(await token.read.hasRole([adminRole, deployer.account.address]), false);
assert.equal(await manager.read.totalProducts(), seedDemo ? 3n : 0n);

const frontendContractPath = resolve(
  "../frontend/src/contracts/WarrantySystem.json",
);
const frontendConfig = {
  network: {
    name: chainId === 11155111 ? "Sepolia" : "Hardhat Local",
    chainId,
    rpcUrl: process.env.FRONTEND_RPC_URL ?? (
      chainId === 11155111
        ? "https://ethereum-sepolia-rpc.publicnode.com"
        : "http://127.0.0.1:8545"
    ),
  },
  fees: {
    registrationFee: registrationFee.toString(),
    transferFee: transferFee.toString(),
    creatorRoyaltyBps: 1000,
  },
  contracts: {
    manager: { address: manager.address, abi: manager.abi },
    nft: { address: nft.address, abi: nft.abi },
    token: { address: token.address, abi: token.abi },
  },
};

await mkdir(dirname(frontendContractPath), { recursive: true });
await writeFile(
  frontendContractPath,
  `${JSON.stringify(frontendConfig, null, 2)}\n`,
  "utf8",
);

console.log("WarrantyManager:", manager.address);
console.log("WarrantyNFT:", nft.address);
console.log("WarrantyToken:", token.address);
console.log("Demo products:", seedDemo ? demoProducts.length : 0);
console.log("Frontend contract data:", frontendContractPath);
console.log("Deployment verified successfully.");
