import { randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "viem";

const NONCE_TTL_MS = 5 * 60 * 1000;

export function createUploadAuth({ publicBaseUrl, now = () => Date.now() }) {
  const challenges = new Map();

  function issue(rawAddress) {
    const address = getAddress(rawAddress);
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = now() + NONCE_TTL_MS;
    const message = [
      "Warranty Passport IPFS upload",
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
      `Service: ${publicBaseUrl}`,
    ].join("\n");
    challenges.set(address, { nonce, expiresAt, message });
    return { address, nonce, expiresAt, message };
  }

  async function verify({ rawAddress, nonce, signature }) {
    const address = getAddress(rawAddress);
    const challenge = challenges.get(address);
    challenges.delete(address);
    if (!challenge || challenge.nonce !== nonce || challenge.expiresAt < now()) return false;
    return verifyMessage({ address, message: challenge.message, signature });
  }

  return { issue, verify };
}
