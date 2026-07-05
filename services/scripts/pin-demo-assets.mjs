import { readFile, writeFile } from "node:fs/promises";

import { createPassportSvg } from "../app.mjs";
import { createFilebaseStore } from "../ipfs-store.mjs";

const store = createFilebaseStore({
  token: process.env.FILEBASE_RPC_TOKEN,
  rpcUrl: process.env.FILEBASE_RPC_URL,
  gatewayUrl: process.env.FILEBASE_GATEWAY_URL,
});
const frontendUrl = (process.env.FRONTEND_URL ?? "https://warranty-passport-dapp.vercel.app").replace(/\/$/, "");
const products = [
  { name: "iPhone 15", category: "Phone", serialNumber: "IPH15-DEMO-001", price: "800", file: "iphone-15-warranty.txt" },
  { name: "MacBook Air", category: "Computer", serialNumber: "MBA-DEMO-002", price: "1200", file: "macbook-air-warranty.txt" },
  { name: "Electric Bicycle", category: "Mobility", serialNumber: "EBIKE-DEMO-003", price: "1800", file: "electric-bicycle-warranty.txt" },
  { name: "Pictorial Art", category: "Art", serialNumber: "PA_102", price: "1234", file: "pictorial-art-warranty-PA-102.txt" },
];

const assets = [];
const serviceBytes = await readFile(new URL("../demo-documents/macbook-air-service.txt", import.meta.url));
const serviceCid = await store.addBytes(serviceBytes, {
  filename: "macbook-air-service.txt",
  contentType: "text/plain",
});
for (let index = 0; index < products.length; index++) {
  const product = products[index];
  const documentBytes = await readFile(new URL(`../demo-documents/${product.file}`, import.meta.url));
  const documentCid = await store.addBytes(documentBytes, { filename: product.file, contentType: "text/plain" });
  const image = createPassportSvg(product.name, product.category, product.serialNumber);
  const imageCid = await store.addBytes(Buffer.from(image), { filename: `${product.serialNumber}-passport.svg`, contentType: "image/svg+xml" });
  const metadata = {
    name: `Warranty Passport: ${product.name}`,
    description: `On-chain warranty passport for ${product.name} (${product.serialNumber}).`,
    image: `ipfs://${imageCid}`,
    external_url: `${frontendUrl}/?product=${index + 1}`,
    attributes: [
      { trait_type: "Category", value: product.category },
      { trait_type: "Serial Number", value: product.serialNumber },
      { trait_type: "Warranty Days", value: 365 },
      { trait_type: "Original Price WTY", value: product.price },
    ],
    properties: { warrantyDocument: `ipfs://${documentCid}` },
  };
  const metadataCid = await store.addBytes(Buffer.from(JSON.stringify(metadata, null, 2)), { filename: `${product.serialNumber}-metadata.json`, contentType: "application/json" });
  assets.push({
    ...product,
    documentUri: `ipfs://${documentCid}`,
    metadataUri: `ipfs://${metadataCid}`,
    imageUri: `ipfs://${imageCid}`,
    ...(index === 1 ? { serviceDocumentUri: `ipfs://${serviceCid}` } : {}),
  });
  console.log(`Pinned ${product.name}: ${metadataCid}`);
}

await writeFile(new URL("../demo-assets.json", import.meta.url), `${JSON.stringify(assets, null, 2)}\n`);
console.log("Demo asset manifest written to services/demo-assets.json");
