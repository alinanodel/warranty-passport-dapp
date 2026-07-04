import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Web3 } from "web3";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Abi,
  type Address,
} from "viem";

import systemConfig from "./contracts/WarrantySystem.json";

const manager = systemConfig.contracts.manager as {
  address: Address;
  abi: Abi;
};
const nft = systemConfig.contracts.nft as { address: Address; abi: Abi };
const token = systemConfig.contracts.token as { address: Address; abi: Abi };
const IPFS_API = (
  import.meta.env.VITE_SERVICES_URL ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const IPFS_GATEWAY = (
  import.meta.env.VITE_IPFS_GATEWAY ?? "https://ipfs.filebase.io/ipfs"
).replace(/\/$/, "");

const chain = defineChain({
  id: systemConfig.network.chainId,
  name: systemConfig.network.name,
  nativeCurrency: {
    name: systemConfig.network.chainId === 11155111 ? "Sepolia Ether" : "Local Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: { default: { http: [systemConfig.network.rpcUrl] } },
});
const publicClient = createPublicClient({
  chain,
  transport: http(systemConfig.network.rpcUrl),
});
const web3 = new Web3(systemConfig.network.rpcUrl);

const warrantyLabels = ["Active", "Expired", "Transferred", "Problematic"];
const safetyLabels = ["Normal", "Lost", "Stolen"];

type Product = {
  productId: bigint;
  name: string;
  category: string;
  serialNumber: string;
  purchaseDate: bigint;
  warrantyPeriod: bigint;
  originalPrice: bigint;
  primaryIpfsHash: string;
  currentOwner: Address;
  originalCreator: Address;
  tokenId: bigint;
  safetyStatus: number;
  problematic: boolean;
  exists: boolean;
  warrantyStatus: number;
};

type OwnershipRecord = {
  owner: Address;
  transferredAt: bigint;
  transferPrice: bigint;
};
type ServiceRecord = {
  serviceType: string;
  description: string;
  ipfsHash: string;
  servicedAt: bigint;
  addedBy: Address;
};
type DocumentRecord = {
  documentType: string;
  ipfsHash: string;
  addedAt: bigint;
  addedBy: Address;
};
type StatusRecord = {
  warrantyStatus: number;
  safetyStatus: number;
  problematic: boolean;
  changedAt: bigint;
  changedBy: Address;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeAccounts(accounts: string[]) {
  return accounts.map((address) => getAddress(address));
}

function ProductGlyph({ name, category }: { name: string; category: string }) {
  const productType = `${name} ${category}`.toLowerCase();

  if (productType.includes("bicycle") || productType.includes("mobility")) {
    return (
      <svg viewBox="0 0 180 180" role="img" aria-label={`${name} illustration`}>
        <circle cx="48" cy="124" r="27" />
        <circle cx="137" cy="124" r="27" />
        <path d="M48 124 77 78l28 46H48Zm29-46h27l33 46M94 59h22M83 59l-6 19" />
      </svg>
    );
  }

  if (productType.includes("macbook") || productType.includes("computer")) {
    return (
      <svg viewBox="0 0 180 180" role="img" aria-label={`${name} illustration`}>
        <rect x="33" y="35" width="114" height="78" rx="8" />
        <path d="M20 126h140l-12 15H32l-12-15Z" />
        <circle cx="90" cy="74" r="4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 180 180" role="img" aria-label={`${name} illustration`}>
      <rect x="55" y="18" width="70" height="144" rx="18" />
      <path d="M78 31h24" />
      <circle cx="90" cy="147" r="4" />
      <circle cx="75" cy="50" r="8" />
      <circle cx="101" cy="50" r="8" />
    </svg>
  );
}

function formatDate(timestamp: bigint) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
    new Date(Number(timestamp) * 1000),
  );
}

function ipfsUrl(uri: string) {
  const cid = uri.replace("ipfs://", "");
  return `${IPFS_GATEWAY}/${cid}`;
}

async function readProduct(id: bigint): Promise<Product> {
  const [product, warrantyStatus] = await Promise.all([
    publicClient.readContract({
      ...manager,
      functionName: "getProduct",
      args: [id],
    }),
    publicClient.readContract({
      ...manager,
      functionName: "getWarrantyStatus",
      args: [id],
    }),
  ]);
  return { ...(product as Omit<Product, "warrantyStatus">), warrantyStatus: Number(warrantyStatus) };
}

async function readAllProducts() {
  const total = (await publicClient.readContract({
    ...manager,
    functionName: "totalProducts",
  })) as bigint;
  return Promise.all(
    Array.from({ length: Number(total) }, (_, index) => readProduct(BigInt(index + 1))),
  );
}

export default function App() {
  const [publicProductId, setPublicProductId] = useState(
    () => new URLSearchParams(window.location.search).get("product"),
  );
  const [pendingSection, setPendingSection] = useState<"passports" | "register" | null>(null);
  const [account, setAccount] = useState("");
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<bigint | null>(
    publicProductId ? BigInt(publicProductId) : null,
  );
  const [history, setHistory] = useState<OwnershipRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusRecord[]>([]);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [managerOwner, setManagerOwner] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const detailRequestId = useRef(0);

  const selectedProduct = products.find((product) => product.productId === selectedId);
  const ownedProducts = !account
    ? products
    : products.filter((product) => getAddress(product.currentOwner) === getAddress(account));
  const visibleProducts = products;
  const isOwner = Boolean(
    account && selectedProduct && getAddress(account) === selectedProduct.currentOwner,
  );
  const isAdmin = Boolean(
    account && managerOwner && getAddress(account) === getAddress(managerOwner),
  );

  async function refresh(activeAccount = account) {
    const liveChainId = Number(await web3.eth.getChainId());
    if (liveChainId !== systemConfig.network.chainId) {
      throw new Error(`Wrong network: expected ${systemConfig.network.chainId}, received ${liveChainId}`);
    }
    const [nextProducts, nextManagerOwner] = await Promise.all([
      readAllProducts(),
      publicClient.readContract({ ...manager, functionName: "owner" }) as Promise<Address>,
    ]);
    setProducts(nextProducts);
    setManagerOwner(nextManagerOwner);
    if (!publicProductId) {
      if (!selectedId || !nextProducts.some((product) => product.productId === selectedId)) {
        setSelectedId(nextProducts[0]?.productId ?? null);
      }
    }
    if (activeAccount) {
      setTokenBalance(
        (await publicClient.readContract({
          ...token,
          functionName: "balanceOf",
          args: [activeAccount as Address],
        })) as bigint,
      );
    } else {
      setTokenBalance(0n);
    }
  }

  async function refreshDetail(id: bigint) {
    const requestId = ++detailRequestId.current;
    const [nextHistory, nextServices, nextDocuments, nextStatuses] = await Promise.all([
      publicClient.readContract({ ...manager, functionName: "getOwnershipHistory", args: [id] }),
      publicClient.readContract({ ...manager, functionName: "getServiceHistory", args: [id] }),
      publicClient.readContract({ ...manager, functionName: "getDocuments", args: [id] }),
      publicClient.readContract({ ...manager, functionName: "getStatusHistory", args: [id] }),
    ]);
    if (requestId !== detailRequestId.current) return;
    setHistory(nextHistory as OwnershipRecord[]);
    setServices(nextServices as ServiceRecord[]);
    setDocuments(nextDocuments as DocumentRecord[]);
    setStatusHistory(nextStatuses as StatusRecord[]);
  }

  useEffect(() => {
    const restoreConnection = async () => {
      try {
        const accounts = window.ethereum
          ? (await window.ethereum.request({ method: "eth_accounts" })) as string[]
          : [];
        const normalizedAccounts = normalizeAccounts(accounts);
        const savedAccount = window.localStorage.getItem("warranty-active-account");
        const activeAccount = normalizedAccounts.find(
          (address) => savedAccount && getAddress(savedAccount) === address,
        ) ?? normalizedAccounts[0] ?? "";
        setAvailableAccounts(normalizedAccounts);
        setAccount(activeAccount);
        await refresh(activeAccount);
      } catch {
        setError("Cannot reach the local blockchain.");
      }
    };

    restoreConnection();
  }, []);

  useEffect(() => {
    const syncUrlState = () => {
      setPublicProductId(new URLSearchParams(window.location.search).get("product"));
    };
    window.addEventListener("popstate", syncUrlState);
    return () => window.removeEventListener("popstate", syncUrlState);
  }, []);

  useEffect(() => {
    if (!pendingSection) return;
    const frame = window.requestAnimationFrame(() => {
      window.document.getElementById(pendingSection)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setPendingSection(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingSection, publicProductId, isAdmin]);

  useEffect(() => {
    if (!selectedId) return;
    refreshDetail(selectedId).catch(() => setError("Cannot read product history."));
    const url = `${window.location.origin}/?product=${selectedId}`;
    QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: "#172019", light: "#f4f3e9" } })
      .then(setQrCode)
      .catch(() => setQrCode(""));
  }, [selectedId]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = normalizeAccounts(args[0] as string[]);
      const activeAccount = accounts[0] ?? "";
      setAvailableAccounts(accounts);
      setAccount(activeAccount);
      setTokenBalance(0n);
      if (activeAccount) {
        window.localStorage.setItem("warranty-active-account", activeAccount);
      } else {
        window.localStorage.removeItem("warranty-active-account");
      }
      refresh(activeAccount).catch(() => setError("Cannot refresh wallet data."));
    };
    const chainChanged = () => window.location.reload();
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, []);

  async function connectMetaMask() {
    const provider = window.ethereum;
    if (!provider) {
      setError("MetaMask is not installed in this browser.");
      return;
    }
    setBusy("wallet");
    setError("");
    try {
      const accounts = normalizeAccounts(
        (await provider.request({ method: "eth_requestAccounts" })) as string[],
      );
      await ensureWalletChain();
      const activeAccount = accounts[0] ?? "";
      setAvailableAccounts(accounts);
      setAccount(activeAccount);
      if (activeAccount) window.localStorage.setItem("warranty-active-account", activeAccount);
      await refresh(activeAccount);
    } catch {
      setError("MetaMask connection was not completed.");
    } finally {
      setBusy("");
    }
  }

  async function ensureWalletChain() {
    const provider = window.ethereum;
    if (!provider) throw new Error("MetaMask is not installed in this browser.");
    const expectedChainId = `0x${chain.id.toString(16)}`;
    const currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
    if (currentChainId.toLowerCase() === expectedChainId.toLowerCase()) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: expectedChainId }],
      });
    } catch (switchError) {
      if ((switchError as { code?: number }).code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: expectedChainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [systemConfig.network.rpcUrl],
        }],
      });
    }
  }

  async function manageAccounts() {
    const provider = window.ethereum;
    if (!provider) {
      setError("MetaMask is not installed in this browser.");
      return;
    }
    setBusy("wallet");
    setError("");
    setAccountMenuOpen(false);
    try {
      try {
        await provider.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (revokeError) {
        const code = (revokeError as { code?: number }).code;
        if (code !== 4200 && code !== -32601) throw revokeError;
      }
      const accounts = normalizeAccounts(
        (await provider.request({ method: "eth_requestAccounts" })) as string[],
      );
      if (!accounts.length) throw new Error("No MetaMask account selected");
      const activeAccount = accounts[0];
      setAvailableAccounts(accounts);
      setAccount(activeAccount);
      window.localStorage.setItem("warranty-active-account", activeAccount);
      await refresh(activeAccount);
    } catch (selectionError) {
      const code = (selectionError as { code?: number }).code;
      if (code === -32002) {
        setError("A MetaMask request is already open. Complete it in the extension.");
      } else if (code === 4001) {
        setError("MetaMask account selection was cancelled.");
      } else {
        setError("Cannot change accounts. Open MetaMask and reconnect this site.");
      }
    } finally {
      setBusy("");
    }
  }

  function scrollToSection(sectionId: "passports" | "register") {
    setAccountMenuOpen(false);
    window.history.replaceState(null, "", `/#${sectionId}`);
    setPublicProductId(null);
    setPendingSection(sectionId);
  }

  function openPublicProduct(productId: bigint) {
    const nextUrl = `/?product=${productId}`;
    window.history.pushState(null, "", nextUrl);
    setPublicProductId(productId.toString());
    setSelectedId(productId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectProduct(productId: bigint) {
    if (productId === selectedId) {
      refreshDetail(productId).catch(() => setError("Cannot refresh product history."));
      return;
    }
    setSelectedId(productId);
  }

  async function requestAdditionalAccounts() {
    const provider = window.ethereum;
    if (!provider) return;
    setBusy("wallet");
    setError("");
    setAccountMenuOpen(false);
    try {
      await provider.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = normalizeAccounts(
        (await provider.request({ method: "eth_accounts" })) as string[],
      );
      const activeAccount = accounts[0] ?? "";
      setAvailableAccounts(accounts);
      setAccount(activeAccount);
      if (activeAccount) window.localStorage.setItem("warranty-active-account", activeAccount);
      await refresh(activeAccount);
    } catch {
      setError("MetaMask did not add another account. Use reconnect if it stays unavailable.");
    } finally {
      setBusy("");
    }
  }

  async function selectAccount(nextAccount: string) {
    const normalizedAccount = getAddress(nextAccount);
    setAccount(normalizedAccount);
    setAccountMenuOpen(false);
    setTokenBalance(0n);
    window.localStorage.setItem("warranty-active-account", normalizedAccount);
    try {
      await refresh(normalizedAccount);
    } catch {
      setError("Cannot refresh the selected account.");
    }
  }

  function walletClient() {
    if (!window.ethereum || !account) throw new Error("Connect MetaMask first");
    return createWalletClient({
      account: account as Address,
      chain,
      transport: custom(window.ethereum),
    });
  }

  async function ensureAllowance(amount: bigint) {
    if (!account || amount === 0n) return;
    const allowance = (await publicClient.readContract({
      ...token,
      functionName: "allowance",
      args: [account as Address, manager.address],
    })) as bigint;
    if (allowance >= amount) return;
    setMessage("Approve WTY spending in MetaMask.");
    const hash = await walletClient().writeContract({
      ...token,
      functionName: "approve",
      args: [manager.address, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function runAction(label: string, action: () => Promise<`0x${string}`>) {
    setBusy(label);
    setError("");
    setMessage(`Checking ${chain.name} network in MetaMask...`);
    try {
      await ensureWalletChain();
      setMessage("Confirm the transaction in MetaMask.");
      const hash = await action();
      setMessage("Transaction sent. Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      if (selectedId) await refreshDetail(selectedId);
      setMessage(`${label} completed successfully.`);
    } catch (actionError) {
      setMessage("");
      const error = actionError as {
        code?: number;
        shortMessage?: string;
        message?: string;
      };
      if (error.code === 4001) {
        setError(`${label} was cancelled in MetaMask.`);
      } else {
        const detail = error.shortMessage
          ?? error.message?.split("\n")[0]
          ?? "Unknown transaction error";
        setError(`${label} failed: ${detail}`);
      }
    } finally {
      setBusy("");
    }
  }

  async function uploadFile(file: File | null) {
    if (!file || file.size === 0 || !file.name) return "";
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("The IPFS file must be smaller than 20 MB.");
    }
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${IPFS_API}/api/ipfs/upload`, { method: "POST", body });
    const result = (await response.json()) as { uri?: string; error?: string };
    if (!response.ok || !result.uri) {
      throw new Error(result.error ?? `IPFS upload failed with status ${response.status}`);
    }
    return result.uri;
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file") as File | null;
    const existingIpfsHash = data.get("ipfsHash")?.toString().trim() ?? "";
    if ((!file || file.size === 0 || !file.name) && !existingIpfsHash) {
      setError("Choose a warranty document or enter an existing IPFS URI.");
      return;
    }
    await runAction("Product registration", async () => {
      await ensureAllowance(BigInt(systemConfig.fees.registrationFee));
      const uploaded = await uploadFile(file);
      const ipfsHash = uploaded || existingIpfsHash;
      const purchaseDate = BigInt(
        Math.floor(new Date(`${data.get("purchaseDate")}T00:00:00`).getTime() / 1000),
      );
      const hash = await walletClient().writeContract({
        ...manager,
        functionName: "registerProduct",
        args: [
          data.get("name")?.toString() ?? "",
          data.get("category")?.toString() ?? "",
          data.get("serialNumber")?.toString() ?? "",
          purchaseDate,
          BigInt(Number(data.get("warrantyDays")) * 86_400),
          parseUnits(data.get("originalPrice")?.toString() ?? "0", 18),
          ipfsHash,
          account as Address,
        ],
      });
      form.reset();
      return hash;
    });
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const data = new FormData(event.currentTarget);
    const price = parseUnits(data.get("price")?.toString() ?? "0", 18);
    const royalty = (price * BigInt(systemConfig.fees.creatorRoyaltyBps)) / 10_000n;
    await runAction("Ownership transfer", async () => {
      await ensureAllowance(BigInt(systemConfig.fees.transferFee) + royalty);
      return walletClient().writeContract({
        ...manager,
        functionName: "transferOwnership",
        args: [selectedId, data.get("newOwner") as Address, price],
      });
    });
  }

  async function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const data = new FormData(event.currentTarget);
    await runAction("Document addition", async () => {
      const uploaded = await uploadFile(data.get("file") as File | null);
      return walletClient().writeContract({
        ...manager,
        functionName: "addDocument",
        args: [selectedId, data.get("documentType")?.toString() ?? "", uploaded],
      });
    });
  }

  async function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const data = new FormData(event.currentTarget);
    await runAction("Service record", async () => {
      const uploaded = await uploadFile(data.get("file") as File | null);
      return walletClient().writeContract({
        ...manager,
        functionName: "addServiceRecord",
        args: [
          selectedId,
          data.get("serviceType")?.toString() ?? "",
          data.get("description")?.toString() ?? "",
          uploaded,
          BigInt(Math.floor(Date.now() / 1000)),
        ],
      });
    });
  }

  async function changeSafety(status: number) {
    if (!selectedId) return;
    await runAction("Safety status update", () =>
      walletClient().writeContract({
        ...manager,
        functionName: "setSafetyStatus",
        args: [selectedId, status],
      }),
    );
  }

  async function changeProblematic(problematic: boolean) {
    if (!selectedId) return;
    await runAction("Warranty status update", () =>
      walletClient().writeContract({
        ...manager,
        functionName: "setProblematic",
        args: [selectedId, problematic],
      }),
    );
  }

  return (
    <main className="page-shell">
      <nav className="topbar" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="Warranty Passport home">
          <span className="brand-mark">WP</span>
          <span className="brand-copy">Warranty Passport<small>On-chain product identity</small></span>
        </a>
        <div className="nav-links">
          <button type="button" onClick={() => scrollToSection("passports")}>Passports</button>
          {isAdmin && <button type="button" onClick={() => scrollToSection("register")}>Register</button>}
          <span><i /> {chain.name}</span>
        </div>
        <div className="wallet-area">
          {account && <span className="token-balance">{formatUnits(tokenBalance, 18)} WTY</span>}
          <div className="account-switcher">
            <button
              className="wallet-button"
              onClick={() => account ? setAccountMenuOpen((open) => !open) : connectMetaMask()}
              disabled={busy === "wallet"}
              aria-expanded={account ? accountMenuOpen : undefined}
              aria-haspopup={account ? "menu" : undefined}
            >
              <span className={account ? "status-dot connected" : "status-dot"} />
              <span>{account ? shortAddress(account) : "Connect MetaMask"}</span>
              {account && <span className="wallet-chevron" aria-hidden="true">⌄</span>}
            </button>
            {account && accountMenuOpen && (
              <div className="account-menu" role="menu">
                <div className="account-menu-head">
                  <span>Switch wallet</span>
                  <small>{chain.name}</small>
                </div>
                <div className="account-list">
                  {availableAccounts.map((address, index) => (
                    <button
                      className={`account-option ${getAddress(account) === address ? "active" : ""}`}
                      key={address}
                      onClick={() => selectAccount(address)}
                      role="menuitem"
                    >
                      <span className="account-avatar">{String(index + 1).padStart(2, "0")}</span>
                      <span><strong>Wallet {String(index + 1).padStart(2, "0")}</strong><small>{shortAddress(address)}</small></span>
                      {getAddress(account) === address && <span className="active-label">Active</span>}
                    </button>
                  ))}
                </div>
                <div className="account-menu-actions">
                  <button className="manage-accounts" onClick={requestAdditionalAccounts} role="menuitem">
                    <span>+</span> Add allowed accounts
                  </button>
                  <button className="manage-accounts reconnect-accounts" onClick={manageAccounts} role="menuitem">
                    Reconnect account access
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <header className="dashboard-hero">
        <div className="hero-title">
          <p className="section-label dark-label">Digital ownership, made tangible</p>
          <h1>Every product has<br />a <em>verified story.</em></h1>
          <p className="hero-subtitle">One permanent passport for ownership, warranty, service records and proof of authenticity.</p>
        </div>
        <div className="hero-stats">
          <span>{ownedProducts.length}<small>{account ? "My products" : "Products"}</small></span>
          <span>10%<small>Creator fee</small></span>
          <span>{chain.id}<small>Chain</small></span>
        </div>
      </header>

      {(error || message) && (
        <div className={error ? "notice error-notice" : "notice"} role={error ? "alert" : "status"}>
          {error || message}
        </div>
      )}

      <section className="dashboard-grid" id="passports">
        <aside className="product-list" aria-label="Products">
          <div className="list-heading"><h2>Product passports</h2><span>{visibleProducts.length}</span></div>
          {visibleProducts.map((product) => (
            <button
              className={`product-row ${selectedId === product.productId ? "selected" : ""}`}
              key={product.productId.toString()}
              onClick={() => selectProduct(product.productId)}
            >
              <span className="product-index">{product.productId.toString().padStart(2, "0")}</span>
              <span><strong>{product.name}</strong><small>{product.category} / {product.serialNumber}</small></span>
              <span className="row-badges">
                {account && getAddress(product.currentOwner) === getAddress(account) && <em>Yours</em>}
                <span className={`status-chip status-${product.warrantyStatus}`}>{warrantyLabels[product.warrantyStatus]}</span>
              </span>
            </button>
          ))}
        </aside>

        <article className="product-detail">
          {selectedProduct ? (
            <>
              <div className="product-overview">
                <div className="product-visual">
                  <div className="visual-topline">
                    <span>Digital passport</span>
                    <span>#{selectedProduct.tokenId.toString().padStart(4, "0")}</span>
                  </div>
                  <ProductGlyph name={selectedProduct.name} category={selectedProduct.category} />
                  <div className="visual-footer">
                    <span>{selectedProduct.category}</span>
                    <span>Verified on-chain <i /></span>
                  </div>
                </div>
                <div className="product-summary">
                  <div className="detail-head">
                    <div>
                      <p className="section-label">Authentic product record</p>
                      <h2>{selectedProduct.name}</h2>
                      <p>{selectedProduct.category} / {selectedProduct.serialNumber}</p>
                    </div>
                    <div className="status-stack">
                      <span className={`status-chip status-${selectedProduct.warrantyStatus}`}>{warrantyLabels[selectedProduct.warrantyStatus]}</span>
                      <span className={`safety safety-${selectedProduct.safetyStatus}`}>{safetyLabels[selectedProduct.safetyStatus]}</span>
                    </div>
                  </div>
                  <dl className="facts-grid">
                    <div><dt>Purchase date</dt><dd>{formatDate(selectedProduct.purchaseDate)}</dd></div>
                    <div><dt>Warranty ends</dt><dd>{formatDate(selectedProduct.purchaseDate + selectedProduct.warrantyPeriod)}</dd></div>
                    <div><dt>Original price</dt><dd>{formatEther(selectedProduct.originalPrice)} WTY</dd></div>
                    <div><dt>Current owner</dt><dd>{shortAddress(selectedProduct.currentOwner)}</dd></div>
                  </dl>
                </div>
              </div>
              {selectedProduct.safetyStatus !== 0 && <div className="danger-banner">Warning: this product is marked {safetyLabels[selectedProduct.safetyStatus].toLowerCase()}.</div>}
              <div className="public-tools">
                {qrCode && <img src={qrCode} alt={`QR code for ${selectedProduct.name}`} />}
                <div><p className="section-label">Public record</p><h3>Verify this passport</h3><p>Scan to open the permanent record with ownership, warranty and documents.</p><a href={`/?product=${selectedProduct.productId}`} onClick={(event) => { event.preventDefault(); openPublicProduct(selectedProduct.productId); }}>Open public page ↗</a><a className="x402-link" href={`${IPFS_API}/api/x402/report/${selectedProduct.productId}`} target="_blank" rel="noreferrer">Extended X402 report ↗</a></div>
              </div>

              <div className="records-grid">
                <section><h3>Documents</h3>{documents.map((item, index) => <a className="record" href={ipfsUrl(item.ipfsHash)} target="_blank" rel="noreferrer" key={`${item.ipfsHash}-${index}`}><strong>{item.documentType}</strong><span>{formatDate(item.addedAt)}</span></a>)}</section>
                <section><h3>Service history</h3>{services.length ? services.map((item, index) => <a className="record" href={ipfsUrl(item.ipfsHash)} target="_blank" rel="noreferrer" key={`${item.ipfsHash}-${index}`}><strong>{item.serviceType}</strong><span>{item.description}</span></a>) : <p className="empty">No service records.</p>}</section>
                <section><h3>Ownership history</h3>{history.map((item, index) => <div className="record" key={`${item.owner}-${index}`}><strong>{shortAddress(item.owner)}</strong><span>{formatDate(item.transferredAt)} / {formatEther(item.transferPrice)} WTY</span></div>)}</section>
                <section><h3>Warranty updates</h3>{statusHistory.map((item, index) => <div className="record" key={`${item.changedAt}-${index}`}><strong>{warrantyLabels[item.warrantyStatus]} / {safetyLabels[item.safetyStatus]}</strong><span>{formatDate(item.changedAt)} by {shortAddress(item.changedBy)}</span></div>)}</section>
              </div>

              {isOwner && !publicProductId && (
                <div className="action-panel">
                  <h3>Owner actions</h3>
                  <div className="safety-actions"><button onClick={() => changeSafety(0)}>Normal</button><button onClick={() => changeSafety(1)}>Mark lost</button><button onClick={() => changeSafety(2)}>Mark stolen</button><button onClick={() => changeProblematic(true)}>Problematic</button><button onClick={() => changeProblematic(false)}>Clear issue</button></div>
                  <form onSubmit={submitTransfer}><h4>Transfer ownership</h4><input name="newOwner" required placeholder="Buyer address 0x..." /><input name="price" type="number" min="0.000000000000000001" step="any" required placeholder="Transfer price in WTY" /><button disabled={Boolean(busy)}>Transfer NFT + 10% fee</button></form>
                  <form onSubmit={submitDocument}><h4>Add IPFS document</h4><input name="documentType" required placeholder="Document type" /><input name="file" type="file" required /><button disabled={Boolean(busy)}>Upload and add</button></form>
                  <form onSubmit={submitService}><h4>Add service record</h4><input name="serviceType" required placeholder="Repair / Inspection" /><input name="description" required placeholder="Description" /><input name="file" type="file" required /><button disabled={Boolean(busy)}>Upload service record</button></form>
                </div>
              )}
            </>
          ) : <p>Select a product.</p>}
        </article>
      </section>

      {!publicProductId && isAdmin && (
        <section className="registration-section" id="register" aria-labelledby="registration-title">
          <div className="registration-intro"><p className="section-label dark-label">Admin / Store</p><h2 id="registration-title">Register a product</h2><p>Registration costs {formatUnits(BigInt(systemConfig.fees.registrationFee), 18)} WTY and rewards the product owner with WTY.</p></div>
          <form className="product-form" onSubmit={submitRegistration}>
            <label>Product name<input name="name" required placeholder="Product name" /></label>
            <label>Category<input name="category" required placeholder="Category" /></label>
            <label>Serial number<input name="serialNumber" required placeholder="Serial number" /></label>
            <label>Purchase date<input name="purchaseDate" type="date" required /></label>
            <label>Warranty period, days<input name="warrantyDays" type="number" min="1" required /></label>
            <label>Original price, WTY<input name="originalPrice" type="number" min="0" required /></label>
            <label className="wide-field">Warranty document<input name="file" type="file" /></label>
            <label className="wide-field">Existing IPFS URI<input name="ipfsHash" placeholder="ipfs://... (if no file)" /></label>
            <button className="submit-button wide-field" disabled={Boolean(busy)}>Upload, register and mint NFT</button>
          </form>
        </section>
      )}

      <footer><span>Warranty Passport Dapp</span><span>NFT / IPFS / ERC20 / X402</span></footer>
    </main>
  );
}
