import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { network } from "hardhat";
import { getAddress } from "viem";

const TOKEN_ADDRESS = getAddress("0xb086a6D8d481bd1B15B18D7954976D9F67043309");
const NFT_ADDRESS = getAddress("0x66B0D5E67a788275A88B814ED68378Ee9Fc3DA2f");
const MANAGER_ADDRESS = getAddress("0x877ab79A17225108Bddb34b645d62a67A7fdB000");

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const token = await viem.getContractAt("WarrantyToken", TOKEN_ADDRESS);
const nft = await viem.getContractAt("WarrantyNFT", NFT_ADDRESS);
const manager = await viem.getContractAt("WarrantyManager", MANAGER_ADDRESS);

const minterRole = await token.read.MINTER_ROLE();
const adminRole = await token.read.DEFAULT_ADMIN_ROLE();

if (await token.read.hasRole([adminRole, deployer.account.address])) {
  console.log("Removing the deployer token admin role...");
  const hash = await token.write.renounceRole(
    [adminRole, deployer.account.address],
    { gas: 100_000n },
  );
  await publicClient.waitForTransactionReceipt({ hash });
}

assert.equal(await token.read.hasRole([minterRole, MANAGER_ADDRESS]), true);
assert.equal(await token.read.hasRole([minterRole, deployer.account.address]), false);
assert.equal(await token.read.hasRole([adminRole, deployer.account.address]), false);
assert.equal(await nft.read.manager(), MANAGER_ADDRESS);
assert.equal(await manager.read.warrantyNFT(), NFT_ADDRESS);
assert.equal(await manager.read.warrantyToken(), TOKEN_ADDRESS);

const chainId = await publicClient.getChainId();
assert.equal(chainId, 11155111);

const frontendContractPath = resolve(
  "../frontend/src/contracts/WarrantySystem.json",
);
const frontendConfig = {
  network: {
    name: "Sepolia",
    chainId,
    rpcUrl: process.env.FRONTEND_RPC_URL
      ?? "https://ethereum-sepolia-rpc.publicnode.com",
  },
  fees: {
    registrationFee: (await manager.read.registrationFee()).toString(),
    transferFee: (await manager.read.transferFee()).toString(),
    creatorRoyaltyBps: 1000,
  },
  contracts: {
    manager: { address: MANAGER_ADDRESS, abi: manager.abi },
    nft: { address: NFT_ADDRESS, abi: nft.abi },
    token: { address: TOKEN_ADDRESS, abi: token.abi },
  },
};

await mkdir(dirname(frontendContractPath), { recursive: true });
await writeFile(
  frontendContractPath,
  `${JSON.stringify(frontendConfig, null, 2)}\n`,
  "utf8",
);

console.log("WarrantyManager:", MANAGER_ADDRESS);
console.log("WarrantyNFT:", NFT_ADDRESS);
console.log("WarrantyToken:", TOKEN_ADDRESS);
console.log("Frontend contract data:", frontendContractPath);
console.log("Sepolia deployment finalized and verified successfully.");
