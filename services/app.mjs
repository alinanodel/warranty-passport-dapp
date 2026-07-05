import cors from "cors";
import express from "express";
import multer from "multer";
import { getAddress } from "viem";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

import { createUploadAuth } from "./upload-auth.mjs";

const BASE_SEPOLIA = "eip155:84532";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export function createApp({
  ipfsStore,
  buildProductReport,
  publicBaseUrl,
  corsOrigin,
  x402PayTo,
  liveX402 = false,
  facilitatorUrl = "https://x402.org/facilitator",
}) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const uploadAuth = createUploadAuth({ publicBaseUrl });
  const uploadWindows = new Map();

  app.disable("x-powered-by");
  app.use(cors({
    origin: corsOrigin === "*" ? "*" : corsOrigin.split(",").map((value) => value.trim()),
    exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
  }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ipfs: "filebase", x402Network: BASE_SEPOLIA, liveX402 });
  });

  app.get("/api/auth/upload-challenge", (req, res) => {
    try {
      res.json(uploadAuth.issue(req.query.address));
    } catch {
      res.status(400).json({ error: "A valid wallet address is required" });
    }
  });

  const requireWalletSignature = async (req, res, next) => {
    try {
      const valid = await uploadAuth.verify({
        rawAddress: req.header("X-Wallet-Address"),
        nonce: req.header("X-Wallet-Nonce"),
        signature: req.header("X-Wallet-Signature"),
      });
      if (!valid) return res.status(401).json({ error: "A fresh wallet signature is required" });
      req.walletAddress = getAddress(req.header("X-Wallet-Address"));
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid wallet authentication" });
    }
  };

  app.post(
    "/api/ipfs/upload",
    createUploadRateLimit(uploadWindows),
    requireWalletSignature,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) return res.status(400).json({ error: "A file is required" });
        const cid = await ipfsStore.addBytes(req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype || "application/octet-stream",
        });
        return res.status(201).json(ipfsResult(cid, ipfsStore.gatewayUrl));
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/ipfs/product-assets",
    createUploadRateLimit(uploadWindows),
    requireWalletSignature,
    upload.single("file"),
    async (req, res, next) => {
      try {
        const existingDocumentUri = `${req.body.documentUri || ""}`.trim();
        if (!req.file && !existingDocumentUri.startsWith("ipfs://")) {
          return res.status(400).json({ error: "A warranty file or existing IPFS URI is required" });
        }
        const required = ["name", "category", "serialNumber", "purchaseDate", "warrantyDays", "originalPrice"];
        if (required.some((field) => !req.body[field]?.trim())) {
          return res.status(400).json({ error: "Complete all product metadata fields before upload" });
        }

        const documentCid = req.file
          ? await ipfsStore.addBytes(req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype || "application/octet-stream",
          })
          : existingDocumentUri.slice("ipfs://".length);
        const documentUri = `ipfs://${documentCid}`;
        const image = createPassportSvg(req.body.name, req.body.category, req.body.serialNumber);
        const imageCid = await ipfsStore.addBytes(Buffer.from(image), {
          filename: `${safeName(req.body.serialNumber)}-passport.svg`,
          contentType: "image/svg+xml",
        });
        const publicUrl = `${req.body.publicUrl || ""}`.trim();
        const metadata = {
          name: `Warranty Passport: ${req.body.name}`,
          description: `On-chain warranty passport for ${req.body.name} (${req.body.serialNumber}).`,
          image: `ipfs://${imageCid}`,
          external_url: publicUrl || undefined,
          attributes: [
            { trait_type: "Category", value: req.body.category },
            { trait_type: "Serial Number", value: req.body.serialNumber },
            { trait_type: "Purchase Date", value: req.body.purchaseDate },
            { trait_type: "Warranty Days", value: Number(req.body.warrantyDays) },
            { trait_type: "Original Price WTY", value: req.body.originalPrice },
          ],
          properties: { warrantyDocument: documentUri },
        };
        const metadataCid = await ipfsStore.addBytes(Buffer.from(JSON.stringify(metadata, null, 2)), {
          filename: `${safeName(req.body.serialNumber)}-metadata.json`,
          contentType: "application/json",
        });
        return res.status(201).json({
          document: ipfsResult(documentCid, ipfsStore.gatewayUrl),
          image: ipfsResult(imageCid, ipfsStore.gatewayUrl),
          metadata: ipfsResult(metadataCid, ipfsStore.gatewayUrl),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.get("/ipfs/:cid", (req, res) => {
    res.redirect(302, `${ipfsStore.gatewayUrl}/${encodeURIComponent(req.params.cid)}`);
  });

  if (liveX402) {
    const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitator).register(BASE_SEPOLIA, new ExactEvmScheme());
    app.use(paymentMiddleware({
      "GET /api/x402/report/*": {
        accepts: { scheme: "exact", price: "$0.001", network: BASE_SEPOLIA, payTo: x402PayTo },
        description: "Extended Warranty Passport product report",
      },
    }, resourceServer, { appName: "Warranty Passport", testnet: true }));
  } else {
    app.get("/api/x402/report/:productId", (req, res) => {
      if (req.header("PAYMENT-SIGNATURE")) {
        return res.status(503).json({ error: "Live X402 settlement is disabled" });
      }
      const paymentRequired = {
        x402Version: 2,
        error: "Payment required",
        resource: {
          url: `${publicBaseUrl}${req.originalUrl}`,
          description: "Extended Warranty Passport product report",
          mimeType: "application/json",
        },
        accepts: [{
          scheme: "exact",
          network: BASE_SEPOLIA,
          amount: "1000",
          asset: BASE_SEPOLIA_USDC,
          payTo: x402PayTo,
          maxTimeoutSeconds: 300,
          extra: { name: "USDC", version: "2" },
        }],
      };
      return res.status(402)
        .set("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"))
        .json(paymentRequired);
    });
  }

  app.get("/api/x402/report/:productId", async (req, res) => {
    try {
      res.json(await buildProductReport(req.params.productId));
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

  return app;
}

function createUploadRateLimit(windows) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
      return next();
    }
    if (current.count >= 20) return res.status(429).json({ error: "IPFS upload rate limit exceeded" });
    current.count += 1;
    return next();
  };
}

function ipfsResult(cid, gatewayUrl) {
  return { cid, uri: `ipfs://${cid}`, gatewayUrl: `${gatewayUrl}/${cid}` };
}

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "product";
}

export function createPassportSvg(name, category, serialNumber) {
  const escape = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" rx="80" fill="#e8edff"/><circle cx="990" cy="210" r="210" fill="#3159f5" opacity=".16"/><text x="90" y="150" font-family="Arial,sans-serif" font-size="42" font-weight="700" fill="#3159f5">WARRANTY PASSPORT</text><text x="90" y="560" font-family="Georgia,serif" font-size="112" fill="#151923">${escape(name)}</text><text x="90" y="650" font-family="Arial,sans-serif" font-size="44" fill="#626874">${escape(category)} / ${escape(serialNumber)}</text><text x="90" y="1080" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#151923">VERIFIED ON-CHAIN</text><circle cx="530" cy="1067" r="12" fill="#30b66a"/></svg>`;
}
