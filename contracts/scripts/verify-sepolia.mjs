import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const deployment = JSON.parse(await readFile(new URL("../deployments/11155111.json", import.meta.url), "utf8"));
const hardhat = resolve("node_modules/.bin/hardhat");

for (const entry of Object.values(deployment.contracts)) {
  console.log(`Verifying ${entry.contract} at ${entry.address}...`);
  const result = spawnSync(hardhat, [
    "verify",
    "etherscan",
    "--network",
    "sepolia",
    "--contract",
    entry.contract,
    entry.address,
    ...entry.constructorArgs,
  ], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("All three contracts are verified on Etherscan.");
