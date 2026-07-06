import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import { createUploadAuth } from "../upload-auth.mjs";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

describe("Upload authorization", () => {
  it("accepts a signed nonce only once", async () => {
    const uploadAuth = createUploadAuth({
      publicBaseUrl: "https://services.example.test",
    });
    const challenge = uploadAuth.issue(account.address);
    const signature = await account.signMessage({ message: challenge.message });
    const proof = {
      rawAddress: account.address,
      nonce: challenge.nonce,
      signature,
    };

    assert.equal(await uploadAuth.verify(proof), true);
    assert.equal(await uploadAuth.verify(proof), false);
  });

  it("rejects a signed nonce after its expiration time", async () => {
    let currentTime = Date.UTC(2026, 6, 6, 12, 0, 0);
    const uploadAuth = createUploadAuth({
      publicBaseUrl: "https://services.example.test",
      now: () => currentTime,
    });
    const challenge = uploadAuth.issue(account.address);
    const signature = await account.signMessage({ message: challenge.message });
    currentTime = challenge.expiresAt + 1;

    assert.equal(await uploadAuth.verify({
      rawAddress: account.address,
      nonce: challenge.nonce,
      signature,
    }), false);
  });
});
