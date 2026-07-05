import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";

import { createApp } from "./app.mjs";
import { createFilebaseStore } from "./ipfs-store.mjs";
import { createProductReportBuilder } from "./report-builder.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173";
const X402_PAY_TO = process.env.X402_PAY_TO ?? "0x34a6746F8BC407A98957cdF565dCEDDca5420E77";
const systemConfig = JSON.parse(await readFile(new URL("../frontend/src/contracts/WarrantySystem.json", import.meta.url), "utf8"));
const manager = systemConfig.contracts.manager;
const publicClient = createPublicClient({ transport: http(process.env.SEPOLIA_RPC_URL ?? systemConfig.network.rpcUrl) });
const ipfsStore = createFilebaseStore({
  token: process.env.FILEBASE_RPC_TOKEN,
  rpcUrl: process.env.FILEBASE_RPC_URL,
  gatewayUrl: process.env.FILEBASE_GATEWAY_URL,
});
const buildProductReport = createProductReportBuilder({ publicClient, manager });

const app = createApp({
  ipfsStore,
  buildProductReport,
  publicBaseUrl: PUBLIC_BASE_URL,
  corsOrigin: CORS_ORIGIN,
  x402PayTo: X402_PAY_TO,
  liveX402: process.env.X402_LIVE === "true",
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
});

const server = app.listen(PORT, HOST, () => console.log(`Warranty services listening at ${PUBLIC_BASE_URL}`));
const shutdown = () => server.close();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
