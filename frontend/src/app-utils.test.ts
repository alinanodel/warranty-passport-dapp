import { describe, expect, it, vi } from "vitest";

import {
  advanceRegistrationStage,
  filterProductsByOwner,
  pageRecords,
  publicProductUrl,
  withRetry,
} from "./app-utils";

describe("registration flow", () => {
  it("requires upload before approval and approval before registration", () => {
    expect(advanceRegistrationStage("upload", "upload")).toBe("approve");
    expect(advanceRegistrationStage("approve", "approve")).toBe("register");
    expect(advanceRegistrationStage("upload", "approve")).toBe("upload");
  });
});

describe("product views", () => {
  const products = [{ currentOwner: "0xAAA", id: 1 }, { currentOwner: "0xBBB", id: 2 }];

  it("switches between all products and the connected owner's products", () => {
    expect(filterProductsByOwner(products, "all", "0xAAA")).toHaveLength(2);
    expect(filterProductsByOwner(products, "mine", "0xaaa")).toEqual([products[0]]);
  });

  it("builds a permanent public verification URL", () => {
    expect(publicProductUrl("https://example.test/", 4n)).toBe("https://example.test/?product=4");
  });

  it("unwraps records returned by paginated contract getters", () => {
    const records = [{ ipfsHash: "ipfs://bafy-document" }];
    expect(pageRecords([records, 1n])).toEqual(records);
  });
});

describe("RPC retry", () => {
  it("recovers from a transient RPC failure", async () => {
    vi.useFakeTimers();
    const action = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue("ok");
    const result = withRetry(action, 3, 1);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("ok");
    expect(action).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
