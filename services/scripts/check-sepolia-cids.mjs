import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";

const config = JSON.parse(await readFile(new URL("../../frontend/src/contracts/WarrantySystem.json", import.meta.url), "utf8"));
const gateway = (process.env.FILEBASE_GATEWAY_URL ?? "https://ipfs.filebase.io/ipfs").replace(/\/$/, "");
const client = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL ?? config.network.rpcUrl) });
const manager = config.contracts.manager;
const total = await client.readContract({ ...manager, functionName: "totalProducts" });
const entries = [];
let foundPictorialArt = false;

for (let productId = 1n; productId <= total; productId++) {
  const [product, documents, services] = await Promise.all([
    client.readContract({ ...manager, functionName: "getProduct", args: [productId] }),
    client.readContract({ ...manager, functionName: "getDocuments", args: [productId] }),
    client.readContract({ ...manager, functionName: "getServiceHistory", args: [productId] }),
  ]);
  if (product.serialNumber === "PA_102") foundPictorialArt = true;
  entries.push(
    { label: `product ${productId} warranty`, uri: product.primaryIpfsHash },
    { label: `product ${productId} metadata`, uri: product.metadataIpfsHash },
    ...documents.map((record, index) => ({ label: `product ${productId} document ${index + 1}`, uri: record.ipfsHash })),
    ...services.map((record, index) => ({ label: `product ${productId} service ${index + 1}`, uri: record.ipfsHash })),
  );
}

assert.equal(foundPictorialArt, true, "Pictorial Art / PA_102 is missing from the current deployment");
for (const entry of new Map(entries.map((entry) => [entry.uri, entry])).values()) {
  assert.match(entry.uri, /^ipfs:\/\//, `${entry.label} does not contain an IPFS URI`);
  const response = await fetch(`${gateway}/${entry.uri.slice("ipfs://".length)}`);
  assert.equal(response.ok, true, `${entry.label} is unavailable: HTTP ${response.status}`);
  console.log(`OK ${entry.label}: ${entry.uri}`);
}

console.log(`Verified ${entries.length} on-chain IPFS references, including Pictorial Art.`);
