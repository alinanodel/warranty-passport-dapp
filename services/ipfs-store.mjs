const DEFAULT_RPC_URL = "https://rpc.filebase.io";
const DEFAULT_GATEWAY_URL = "https://ipfs.filebase.io/ipfs";

export function createFilebaseStore({
  token,
  rpcUrl = DEFAULT_RPC_URL,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error("FILEBASE_RPC_TOKEN is required");

  return {
    gatewayUrl: gatewayUrl.replace(/\/$/, ""),
    async addBytes(bytes, { filename, contentType }) {
      const body = new FormData();
      body.append("file", new Blob([bytes], { type: contentType }), filename);
      const response = await fetchImpl(
        `${rpcUrl.replace(/\/$/, "")}/api/v0/add?cid-version=1&wrap-with-directory=false`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
        },
      );
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Filebase upload failed (${response.status}): ${text.slice(0, 200)}`);
      }
      const records = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const cid = records.at(-1)?.Hash;
      if (!cid) throw new Error("Filebase did not return an IPFS CID");
      return cid;
    },
  };
}

export function createMemoryStore() {
  const files = new Map();
  let sequence = 0;
  return {
    gatewayUrl: "https://example.test/ipfs",
    files,
    async addBytes(bytes, metadata) {
      const cid = `bafy-test-${++sequence}`;
      files.set(cid, { bytes: Buffer.from(bytes), ...metadata });
      return cid;
    },
  };
}
