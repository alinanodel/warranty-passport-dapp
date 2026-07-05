import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import { createApp } from "../app.mjs";
import { createMemoryStore } from "../ipfs-store.mjs";
import { createProductReportBuilder } from "../report-builder.mjs";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("Warranty Passport services", () => {
  let server;
  let baseUrl;
  let store;

  beforeEach(async () => {
    store = createMemoryStore();
    const app = createApp({
      ipfsStore: store,
      buildProductReport: async (id) => ({ productId: id }),
      publicBaseUrl: "https://services.example.test",
      corsOrigin: "https://frontend.example.test",
      x402PayTo: account.address,
      liveX402: false,
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("reports Filebase and X402 health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      ipfs: "filebase",
      x402Network: "eip155:84532",
      liveX402: false,
    });
  });

  it("rejects uploads without a wallet signature", async () => {
    const body = new FormData();
    body.append("file", new Blob(["warranty"]), "warranty.txt");
    const response = await fetch(`${baseUrl}/api/ipfs/upload`, { method: "POST", body });
    assert.equal(response.status, 401);
  });

  it("accepts a signed upload and returns a permanent IPFS URI", async () => {
    const auth = await signedUploadHeaders();
    const body = new FormData();
    body.append("file", new Blob(["warranty"], { type: "text/plain" }), "warranty.txt");
    const response = await fetch(`${baseUrl}/api/ipfs/upload`, { method: "POST", headers: auth, body });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.uri, "ipfs://bafy-test-1");
    assert.equal(store.files.get(result.cid).filename, "warranty.txt");
  });

  it("redirects IPFS retrieval to the permanent Filebase gateway", async () => {
    const response = await fetch(`${baseUrl}/ipfs/bafy-example`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://example.test/ipfs/bafy-example");
  });

  it("creates warranty document, image and ERC721 metadata assets", async () => {
    const auth = await signedUploadHeaders();
    const body = new FormData();
    body.append("file", new Blob(["warranty"], { type: "text/plain" }), "warranty.txt");
    body.append("name", "Camera");
    body.append("category", "Electronics");
    body.append("serialNumber", "CAM-001");
    body.append("purchaseDate", "2026-07-05");
    body.append("warrantyDays", "365");
    body.append("originalPrice", "900");
    body.append("publicUrl", "https://frontend.example.test/?product=5");
    const response = await fetch(`${baseUrl}/api/ipfs/product-assets`, { method: "POST", headers: auth, body });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.document.uri, "ipfs://bafy-test-1");
    assert.equal(result.image.uri, "ipfs://bafy-test-2");
    assert.equal(result.metadata.uri, "ipfs://bafy-test-3");
    const metadata = JSON.parse(store.files.get(result.metadata.cid).bytes.toString());
    assert.equal(metadata.image, result.image.uri);
    assert.equal(metadata.properties.warrantyDocument, result.document.uri);
  });

  it("returns a standards-shaped X402 challenge while live settlement is disabled", async () => {
    const response = await fetch(`${baseUrl}/api/x402/report/4`);
    assert.equal(response.status, 402);
    assert.ok(response.headers.get("payment-required"));
    const challenge = await response.json();
    assert.equal(challenge.accepts[0].network, "eip155:84532");
    const paidAttempt = await fetch(`${baseUrl}/api/x402/report/4`, { headers: { "PAYMENT-SIGNATURE": "test" } });
    assert.equal(paidAttempt.status, 503);
  });

  it("builds an extended X402 report and serializes on-chain bigint values", async () => {
    const publicClient = {
      async readContract({ functionName }) {
        if (functionName === "getProduct") return { name: "Pictorial Art", originalPrice: 1234n };
        if (functionName === "getWarrantyStatus") return 0;
        return [];
      },
    };
    const buildReport = createProductReportBuilder({ publicClient, manager: { address: account.address, abi: [] } });
    const report = await buildReport("4");
    assert.equal(report.productId, "4");
    assert.equal(report.product.name, "Pictorial Art");
    assert.equal(report.product.originalPrice, "1234");
    assert.equal(report.network, "eip155:84532");
  });

  async function signedUploadHeaders() {
    const challengeResponse = await fetch(`${baseUrl}/api/auth/upload-challenge?address=${account.address}`);
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();
    const signature = await account.signMessage({ message: challenge.message });
    return {
      "X-Wallet-Address": account.address,
      "X-Wallet-Nonce": challenge.nonce,
      "X-Wallet-Signature": signature,
    };
  }
});
