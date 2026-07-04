import cors from "cors";
import express from "express";
import multer from "multer";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";
import { CID } from "multiformats/cid";
import { FsBlockstore } from "blockstore-fs";
import { FsDatastore } from "datastore-fs";
import { createPublicClient, http } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`
).replace(/\/$/, "");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173";
const X402_PAY_TO = process.env.X402_PAY_TO ?? "0x34a6746F8BC407A98957cdF565dCEDDca5420E77";
const BASE_SEPOLIA = "eip155:84532";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const LIVE_X402 = process.env.X402_LIVE === "true";
const systemConfig = JSON.parse(
  await readFile(
    new URL("../frontend/src/contracts/WarrantySystem.json", import.meta.url),
    "utf8",
  ),
);
const manager = systemConfig.contracts.manager;
const publicClient = createPublicClient({
  transport: http(process.env.SEPOLIA_RPC_URL ?? systemConfig.network.rpcUrl),
});

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const blockstore = new FsBlockstore(fileURLToPath(new URL("./data/blocks", import.meta.url)));
const datastore = new FsDatastore(fileURLToPath(new URL("./data/datastore", import.meta.url)));
const helia = await createHelia({ blockstore, datastore });
const fs = unixfs(helia);
const fileMetadata = new Map();
const uploadWindows = new Map();

app.disable("x-powered-by");
app.use(cors({
  origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map((value) => value.trim()),
  exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ipfs: "helia", x402Network: BASE_SEPOLIA });
});

app.post("/api/ipfs/upload", uploadRateLimit, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A file is required" });
  const cid = await fs.addBytes(req.file.buffer);
  fileMetadata.set(cid.toString(), {
    contentType: req.file.mimetype,
    filename: req.file.originalname,
  });
  return res.status(201).json({
    cid: cid.toString(),
    uri: `ipfs://${cid}`,
    gatewayUrl: `${PUBLIC_BASE_URL}/ipfs/${cid}`,
  });
});

app.get("/ipfs/:cid", async (req, res) => {
  try {
    const cid = CID.parse(req.params.cid);
    const chunks = [];
    for await (const chunk of fs.cat(cid)) chunks.push(chunk);
    const metadata = fileMetadata.get(cid.toString());
    if (metadata?.contentType) res.type(metadata.contentType);
    if (metadata?.filename) {
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(metadata.filename)}`);
    }
    res.send(Buffer.concat(chunks));
  } catch {
    res.status(404).json({ error: "IPFS content not found on this node" });
  }
});

if (LIVE_X402) {
  const facilitator = new HTTPFacilitatorClient({
    url: "https://facilitator.x402.org",
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    BASE_SEPOLIA,
    new ExactEvmScheme(),
  );
  app.use(
    paymentMiddleware(
      {
        "GET /api/x402/report/*": {
          accepts: {
            scheme: "exact",
            price: "$0.001",
            network: BASE_SEPOLIA,
            payTo: X402_PAY_TO,
          },
          description: "Extended Warranty Passport product report",
        },
      },
      resourceServer,
      { appName: "Warranty Passport", testnet: true },
    ),
  );
} else {
  app.get("/api/x402/report/:productId", (req, res, next) => {
    if (req.header("PAYMENT-SIGNATURE")) {
      return res.status(503).json({
        error: "Live facilitator is disabled. Start with X402_LIVE=true to verify and settle payment.",
      });
    }
    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `${PUBLIC_BASE_URL}${req.originalUrl}`,
        description: "Extended Warranty Passport product report",
        mimeType: "application/json",
      },
      accepts: [{
        scheme: "exact",
        network: BASE_SEPOLIA,
        amount: "1000",
        asset: BASE_SEPOLIA_USDC,
        payTo: X402_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: "USDC", version: "2" },
      }],
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
    return res.status(402).set("PAYMENT-REQUIRED", encoded).json(paymentRequired);
  });
}

app.get("/api/x402/report/:productId", async (req, res) => {
  try {
    const report = await buildProductReport(req.params.productId);
    res.json(report);
  } catch {
    res.status(404).json({ error: "Product report not found" });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "The IPFS file must be smaller than 20 MB" });
  }
  console.error(error);
  return res.status(500).json({ error: "Unexpected service error" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Warranty services listening at ${PUBLIC_BASE_URL}`);
});

async function shutdown() {
  server.close();
  await helia.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function uploadRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip ?? "unknown";
  const current = uploadWindows.get(key);
  if (!current || current.resetAt <= now) {
    uploadWindows.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return next();
  }
  if (current.count >= 20) {
    return res.status(429).json({ error: "IPFS upload rate limit exceeded" });
  }
  current.count += 1;
  return next();
}

export async function buildProductReport(rawProductId) {
  if (!/^[1-9]\d*$/.test(rawProductId)) throw new Error("Invalid product ID");
  const productId = BigInt(rawProductId);
  const [product, warrantyStatus, ownership, services, documents, statuses] =
    await Promise.all([
      publicClient.readContract({ ...manager, functionName: "getProduct", args: [productId] }),
      publicClient.readContract({ ...manager, functionName: "getWarrantyStatus", args: [productId] }),
      publicClient.readContract({ ...manager, functionName: "getOwnershipHistory", args: [productId] }),
      publicClient.readContract({ ...manager, functionName: "getServiceHistory", args: [productId] }),
      publicClient.readContract({ ...manager, functionName: "getDocuments", args: [productId] }),
      publicClient.readContract({ ...manager, functionName: "getStatusHistory", args: [productId] }),
    ]);

  return jsonSafe({
    productId,
    product,
    warrantyStatus,
    ownership,
    services,
    documents,
    statuses,
    paidWith: "x402",
    network: BASE_SEPOLIA,
    generatedAt: new Date().toISOString(),
  });
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}
