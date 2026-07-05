export function createProductReportBuilder({ publicClient, manager }) {
  return async function buildProductReport(rawProductId) {
    if (!/^[1-9]\d*$/.test(rawProductId)) throw new Error("Invalid product ID");
    const productId = BigInt(rawProductId);
    const [product, warrantyStatus, ownership, services, documents, statuses] = await Promise.all([
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getProduct", args: [productId] })),
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getWarrantyStatus", args: [productId] })),
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getOwnershipHistory", args: [productId] })),
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getServiceHistory", args: [productId] })),
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getDocuments", args: [productId] })),
      withRpcRetry(() => publicClient.readContract({ ...manager, functionName: "getStatusHistory", args: [productId] })),
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
      network: "eip155:84532",
      generatedAt: new Date().toISOString(),
    });
  };
}

async function withRpcRetry(action, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
