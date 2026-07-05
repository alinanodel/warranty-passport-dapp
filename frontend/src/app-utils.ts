export type ProductFilter = "all" | "mine";
export type RegistrationStage = "upload" | "approve" | "register";

export function filterProductsByOwner<T extends { currentOwner: string }>(
  products: T[],
  filter: ProductFilter,
  account: string,
) {
  if (filter === "all" || !account) return products;
  return products.filter((product) => product.currentOwner.toLowerCase() === account.toLowerCase());
}

export function publicProductUrl(origin: string, productId: bigint | number | string) {
  return `${origin.replace(/\/$/, "")}/?product=${productId.toString()}`;
}

export function pageRecords<T>(page: readonly [readonly T[], bigint]): T[] {
  return [...page[0]];
}

export function advanceRegistrationStage(
  stage: RegistrationStage,
  completed: "upload" | "approve",
): RegistrationStage {
  if (stage === "upload" && completed === "upload") return "approve";
  if (stage === "approve" && completed === "approve") return "register";
  return stage;
}

export async function withRetry<T>(action: () => Promise<T>, attempts = 3, delayMs = 250): Promise<T> {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
