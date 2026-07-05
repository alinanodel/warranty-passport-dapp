import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

const { viem } = await network.create();
const [admin, productOwner, buyer, feeRecipient, stranger] =
  await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const testClient = await viem.getTestClient();

const DAY = 86_400n;
const REGISTRATION_FEE = parseEther("10");
const TRANSFER_FEE = parseEther("5");
const REGISTRATION_REWARD = parseEther("20");

async function deploySystem() {
  const token = await viem.deployContract("WarrantyToken", [
    admin.account.address,
    parseEther("1000000"),
  ]);
  const nft = await viem.deployContract("WarrantyNFT", [admin.account.address]);
  const manager = await viem.deployContract("WarrantyManager", [
    admin.account.address,
    nft.address,
    token.address,
    feeRecipient.account.address,
    REGISTRATION_FEE,
    TRANSFER_FEE,
    REGISTRATION_REWARD,
  ]);

  await nft.write.setManager([manager.address]);
  const minterRole = await token.read.MINTER_ROLE();
  const adminRole = await token.read.DEFAULT_ADMIN_ROLE();
  await token.write.grantRole([minterRole, manager.address]);
  await token.write.renounceRole([minterRole, admin.account.address]);
  await token.write.renounceRole([adminRole, admin.account.address]);
  await token.write.approve([manager.address, REGISTRATION_FEE]);

  return { token, nft, manager };
}

async function registerProduct(
  system: Awaited<ReturnType<typeof deploySystem>>,
  owner = productOwner.account.address,
) {
  const purchaseDate = (await publicClient.getBlock()).timestamp;
  await system.manager.write.registerProduct([
    "MacBook Air",
    "Electronics",
    "MBA-2026-001",
    purchaseDate,
    365n * DAY,
    parseEther("1000"),
    "ipfs://QmWarrantyDocument",
    "ipfs://QmWarrantyMetadata",
    owner,
  ]);
  return purchaseDate;
}

describe("Warranty Passport system", function () {
  it("deploys separate NFT, ERC20, and manager contracts", async function () {
    const { token, nft, manager } = await deploySystem();

    assert.equal(await token.read.name(), "Warranty Token");
    assert.equal(await token.read.symbol(), "WTY");
    assert.equal(await nft.read.name(), "Warranty Passport");
    assert.equal(await nft.read.symbol(), "WPT");
    assert.equal(await nft.read.manager(), getAddress(manager.address));
    assert.equal(await manager.read.warrantyNFT(), getAddress(nft.address));
    assert.equal(await manager.read.warrantyToken(), getAddress(token.address));
    assert.equal(await token.read.hasRole([await token.read.MINTER_ROLE(), manager.address]), true);
    assert.equal(
      await token.read.hasRole([await token.read.MINTER_ROLE(), admin.account.address]),
      false,
    );
    assert.equal(
      await token.read.hasRole([await token.read.DEFAULT_ADMIN_ROLE(), admin.account.address]),
      false,
    );
  });

  it("registers a product, charges WTY, rewards the owner, stores IPFS, and mints NFT", async function () {
    const system = await deploySystem();
    const feeBalanceBefore = await system.token.read.balanceOf([
      feeRecipient.account.address,
    ]);
    const purchaseDate = await registerProduct(system);

    const product = await system.manager.read.getProduct([1n]);
    const documents = await system.manager.read.getDocuments([1n]);
    const statuses = await system.manager.read.getStatusHistory([1n]);

    assert.equal(product.name, "MacBook Air");
    assert.equal(product.serialNumber, "MBA-2026-001");
    assert.equal(product.purchaseDate, purchaseDate);
    assert.equal(product.primaryIpfsHash, "ipfs://QmWarrantyDocument");
    assert.equal(product.metadataIpfsHash, "ipfs://QmWarrantyMetadata");
    assert.equal(product.currentOwner, getAddress(productOwner.account.address));
    assert.equal(await system.nft.read.ownerOf([1n]), getAddress(productOwner.account.address));
    assert.equal(await system.nft.read.tokenToProductId([1n]), 1n);
    assert.equal(await system.nft.read.tokenURI([1n]), "ipfs://QmWarrantyMetadata");
    assert.equal(await system.manager.read.totalProducts(), 1n);
    assert.equal(
      await system.token.read.balanceOf([productOwner.account.address]),
      REGISTRATION_REWARD,
    );
    assert.equal(
      await system.token.read.balanceOf([feeRecipient.account.address]),
      feeBalanceBefore + REGISTRATION_FEE,
    );
    assert.equal(documents.length, 1);
    assert.equal(documents[0].ipfsHash, "ipfs://QmWarrantyDocument");
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].warrantyStatus, 0);
  });

  it("emits ProductRegistered and DocumentAdded", async function () {
    const system = await deploySystem();
    const purchaseDate = (await publicClient.getBlock()).timestamp;

    await viem.assertions.emitWithArgs(
      system.manager.write.registerProduct([
        "iPhone 15",
        "Phone",
        "IPH-001",
        purchaseDate,
        365n * DAY,
        parseEther("800"),
        "ipfs://QmIPhone",
        "ipfs://QmIPhoneMetadata",
        productOwner.account.address,
      ]),
      system.manager,
      "ProductRegistered",
      [1n, 1n, productOwner.account.address, "iPhone 15", "ipfs://QmIPhone"],
    );

    const events = await publicClient.getContractEvents({
      address: system.manager.address,
      abi: system.manager.abi,
      eventName: "DocumentAdded",
      fromBlock: 0n,
      strict: true,
    });
    assert.equal(events.length, 1);
  });

  it("records ownership date and price and pays 10% creator royalty", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const salePrice = parseEther("100");
    const expectedRoyalty = parseEther("10");

    await system.token.write.approve(
      [system.manager.address, TRANSFER_FEE + expectedRoyalty],
      { account: productOwner.account },
    );

    const creatorBalanceBefore = await system.token.read.balanceOf([
      admin.account.address,
    ]);
    await system.manager.write.transferOwnership(
      [1n, buyer.account.address, salePrice],
      { account: productOwner.account },
    );

    const product = await system.manager.read.getProduct([1n]);
    const history = await system.manager.read.getOwnershipHistory([1n]);
    assert.equal(product.currentOwner, getAddress(buyer.account.address));
    assert.equal(await system.nft.read.ownerOf([1n]), getAddress(buyer.account.address));
    assert.equal(history.length, 2);
    assert.equal(history[1].owner, getAddress(buyer.account.address));
    assert.equal(history[1].transferPrice, salePrice);
    assert.ok(history[1].transferredAt > 0n);
    assert.equal(
      await system.token.read.balanceOf([admin.account.address]),
      creatorBalanceBefore + expectedRoyalty,
    );
    assert.equal(await system.manager.read.getWarrantyStatus([1n]), 2);
    assert.equal((await system.manager.read.getStatusHistory([1n])).length, 2);
  });

  it("emits OwnershipTransferred with timestamp, price, and royalty", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const salePrice = parseEther("100");
    await system.token.write.approve(
      [system.manager.address, TRANSFER_FEE + parseEther("10")],
      { account: productOwner.account },
    );

    await viem.assertions.emit(
      system.manager.write.transferOwnership(
        [1n, buyer.account.address, salePrice],
        { account: productOwner.account },
      ),
      system.manager,
      "OwnershipTransferred",
    );
  });

  it("adds service records and additional IPFS documents", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const serviceDate = (await publicClient.getBlock()).timestamp;

    await viem.assertions.emitWithArgs(
      system.manager.write.addServiceRecord(
        [1n, "Battery replacement", "Replaced battery", "ipfs://QmService", serviceDate],
        { account: productOwner.account },
      ),
      system.manager,
      "ServiceRecordAdded",
      [1n, 0n, "Battery replacement", "ipfs://QmService", serviceDate],
    );
    await system.manager.write.addDocument(
      [1n, "Repair receipt", "ipfs://QmReceipt"],
      { account: productOwner.account },
    );

    const services = await system.manager.read.getServiceHistory([1n]);
    const documents = await system.manager.read.getDocuments([1n]);
    assert.equal(services[0].description, "Replaced battery");
    assert.equal(documents.length, 2);
    assert.equal(documents[1].documentType, "Repair receipt");
  });

  it("returns bounded pages for all accumulated histories", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const serviceDate = (await publicClient.getBlock()).timestamp;
    await system.manager.write.addServiceRecord(
      [1n, "Inspection", "Passed inspection", "ipfs://QmInspection", serviceDate],
      { account: productOwner.account },
    );
    await system.manager.write.addDocument(
      [1n, "Inspection report", "ipfs://QmInspectionReport"],
      { account: productOwner.account },
    );

    const [ownership, ownershipTotal] = await system.manager.read.getOwnershipHistoryPage([1n, 0n, 1n]);
    const [services, serviceTotal] = await system.manager.read.getServiceHistoryPage([1n, 0n, 10n]);
    const [documents, documentTotal] = await system.manager.read.getDocumentsPage([1n, 1n, 1n]);
    const [statuses, statusTotal] = await system.manager.read.getStatusHistoryPage([1n, 0n, 10n]);
    assert.equal(ownership.length, 1);
    assert.equal(ownershipTotal, 1n);
    assert.equal(services.length, 1);
    assert.equal(serviceTotal, 1n);
    assert.equal(documents.length, 1);
    assert.equal(documentTotal, 2n);
    assert.equal(statuses.length, 1);
    assert.equal(statusTotal, 1n);

    await viem.assertions.revertWith(
      system.manager.read.getDocumentsPage([1n, 0n, 101n]),
      "Invalid page size",
    );
  });

  it("supports lost, stolen, and problematic statuses", async function () {
    const system = await deploySystem();
    await registerProduct(system);

    await system.manager.write.setSafetyStatus([1n, 1], {
      account: productOwner.account,
    });
    assert.equal((await system.manager.read.getProduct([1n])).safetyStatus, 1);
    assert.equal(await system.manager.read.getWarrantyStatus([1n]), 3);

    await system.manager.write.setSafetyStatus([1n, 2], {
      account: productOwner.account,
    });
    assert.equal((await system.manager.read.getProduct([1n])).safetyStatus, 2);

    await system.manager.write.setSafetyStatus([1n, 0], {
      account: productOwner.account,
    });
    await system.manager.write.setProblematic([1n, true], {
      account: productOwner.account,
    });
    assert.equal(await system.manager.read.getWarrantyStatus([1n]), 3);
  });

  it("reports active and expired warranties", async function () {
    const system = await deploySystem();
    const purchaseDate = await registerProduct(system);
    assert.equal(await system.manager.read.getWarrantyStatus([1n]), 0);

    await testClient.setNextBlockTimestamp({
      timestamp: purchaseDate + 365n * DAY + 1n,
    });
    await testClient.mine({ blocks: 1 });
    assert.equal(await system.manager.read.getWarrantyStatus([1n]), 1);
  });

  it("returns products belonging to a connected owner", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const ids = await system.manager.read.getProductsByOwner([
      productOwner.account.address,
    ]);
    assert.deepEqual(ids, [1n]);
  });

  it("enforces admin and owner permissions", async function () {
    const system = await deploySystem();
    const purchaseDate = (await publicClient.getBlock()).timestamp;

    await viem.assertions.revertWithCustomError(
      system.manager.write.registerProduct(
        [
          "Watch",
          "Accessories",
          "WATCH-1",
          purchaseDate,
          365n * DAY,
          parseEther("500"),
          "ipfs://QmWatch",
          "ipfs://QmWatchMetadata",
          productOwner.account.address,
        ],
        { account: stranger.account },
      ),
      system.manager,
      "OwnableUnauthorizedAccount",
    );

    await registerProduct(system);
    await viem.assertions.revertWith(
      system.manager.write.setSafetyStatus([1n, 2], {
        account: stranger.account,
      }),
      "Caller is not the product owner",
    );
  });

  it("blocks direct NFT transfers that would bypass ownership history", async function () {
    const system = await deploySystem();
    await registerProduct(system);

    await viem.assertions.revertWith(
      system.nft.write.transferFrom(
        [productOwner.account.address, buyer.account.address, 1n],
        { account: productOwner.account },
      ),
      "Transfers must use WarrantyManager",
    );

    assert.equal(
      await system.nft.read.ownerOf([1n]),
      getAddress(productOwner.account.address),
    );
    assert.equal((await system.manager.read.getOwnershipHistory([1n])).length, 1);
  });

  it("blocks an approved ERC721 operator from bypassing WarrantyManager", async function () {
    const system = await deploySystem();
    await registerProduct(system);

    await system.nft.write.approve([stranger.account.address, 1n], {
      account: productOwner.account,
    });
    await viem.assertions.revertWith(
      system.nft.write.transferFrom(
        [productOwner.account.address, buyer.account.address, 1n],
        { account: stranger.account },
      ),
      "Transfers must use WarrantyManager",
    );

    assert.equal(
      await system.nft.read.ownerOf([1n]),
      getAddress(productOwner.account.address),
    );
    assert.equal((await system.manager.read.getOwnershipHistory([1n])).length, 1);
  });

  it("rolls back fees, ownership, and history when the NFT receiver rejects transfer", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const salePrice = parseEther("100");
    const royalty = parseEther("10");
    await system.token.write.approve(
      [system.manager.address, TRANSFER_FEE + royalty],
      { account: productOwner.account },
    );
    const ownerBalanceBefore = await system.token.read.balanceOf([
      productOwner.account.address,
    ]);
    const feeBalanceBefore = await system.token.read.balanceOf([
      feeRecipient.account.address,
    ]);

    await viem.assertions.revertWithCustomError(
      system.manager.write.transferOwnership(
        [1n, system.token.address, salePrice],
        { account: productOwner.account },
      ),
      system.nft,
      "ERC721InvalidReceiver",
    );

    assert.equal(
      (await system.manager.read.getProduct([1n])).currentOwner,
      getAddress(productOwner.account.address),
    );
    assert.equal(
      await system.nft.read.ownerOf([1n]),
      getAddress(productOwner.account.address),
    );
    assert.equal((await system.manager.read.getOwnershipHistory([1n])).length, 1);
    assert.equal(
      await system.token.read.balanceOf([productOwner.account.address]),
      ownerBalanceBefore,
    );
    assert.equal(
      await system.token.read.balanceOf([feeRecipient.account.address]),
      feeBalanceBefore,
    );
  });

  it("removes product permissions from the previous owner after transfer", async function () {
    const system = await deploySystem();
    await registerProduct(system);
    const salePrice = parseEther("100");
    await system.token.write.approve(
      [system.manager.address, TRANSFER_FEE + parseEther("10")],
      { account: productOwner.account },
    );
    await system.manager.write.transferOwnership(
      [1n, buyer.account.address, salePrice],
      { account: productOwner.account },
    );

    await viem.assertions.revertWith(
      system.manager.write.setSafetyStatus([1n, 2], {
        account: productOwner.account,
      }),
      "Caller is not the product owner",
    );
    await viem.assertions.revertWith(
      system.manager.write.addDocument([1n, "Fake receipt", "ipfs://QmFake"], {
        account: productOwner.account,
      }),
      "Not authorized",
    );

    await system.manager.write.setSafetyStatus([1n, 1], {
      account: buyer.account,
    });
    assert.equal((await system.manager.read.getProduct([1n])).safetyStatus, 1);
  });

  it("locks the NFT manager after initial configuration", async function () {
    const system = await deploySystem();

    await viem.assertions.revertWith(
      system.nft.write.setManager([stranger.account.address]),
      "Manager already configured",
    );
  });

  it("rejects duplicate serials, invalid dates, invalid IPFS, and zero-price transfers", async function () {
    const system = await deploySystem();
    const purchaseDate = await registerProduct(system);

    await viem.assertions.revertWith(
      system.manager.write.registerProduct([
        "Duplicate",
        "Electronics",
        "MBA-2026-001",
        purchaseDate,
        365n * DAY,
        parseEther("1000"),
        "ipfs://QmDuplicate",
        "ipfs://QmDuplicateMetadata",
        productOwner.account.address,
      ]),
      "Serial number already registered",
    );

    await viem.assertions.revertWith(
      system.manager.write.registerProduct([
        "No category",
        "",
        "NO-CATEGORY-001",
        purchaseDate,
        365n * DAY,
        parseEther("1"),
        "ipfs://QmDocument",
        "ipfs://QmMetadata",
        productOwner.account.address,
      ]),
      "Category is required",
    );

    await viem.assertions.revertWith(
      system.manager.write.registerProduct([
        "Free product",
        "Other",
        "FREE-001",
        purchaseDate,
        365n * DAY,
        0n,
        "ipfs://QmDocument",
        "ipfs://QmMetadata",
        productOwner.account.address,
      ]),
      "Original price is required",
    );

    await viem.assertions.revertWith(
      system.manager.write.registerProduct([
        "Bad metadata",
        "Other",
        "BAD-METADATA-001",
        purchaseDate,
        365n * DAY,
        parseEther("1"),
        "ipfs://QmDocument",
        "https://example.com/metadata.json",
        productOwner.account.address,
      ]),
      "Invalid metadata IPFS URI",
    );

    await viem.assertions.revertWith(
      system.manager.write.addDocument([1n, "Receipt", "https://example.com/file"], {
        account: productOwner.account,
      }),
      "Invalid IPFS URI",
    );

    await viem.assertions.revertWith(
      system.manager.write.transferOwnership([1n, buyer.account.address, 0n], {
        account: productOwner.account,
      }),
      "Transfer price is required",
    );
  });

  it("caps the WTY supply", async function () {
    const token = await viem.deployContract("WarrantyToken", [
      admin.account.address,
      parseEther("9999999"),
    ]);

    await token.write.mintReward([productOwner.account.address, parseEther("1")]);
    await viem.assertions.revertWith(
      token.write.mintReward([productOwner.account.address, 1n]),
      "Max supply exceeded",
    );
  });
});
