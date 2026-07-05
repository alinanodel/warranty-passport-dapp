// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {WarrantyNFT} from "./WarrantyNFT.sol";
import {WarrantyToken} from "./WarrantyToken.sol";

contract WarrantyManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum WarrantyStatus {
        Active,
        Expired,
        Transferred,
        Problematic
    }

    enum SafetyStatus {
        Normal,
        Lost,
        Stolen
    }

    struct Product {
        uint256 productId;
        string name;
        string category;
        string serialNumber;
        uint256 purchaseDate;
        uint256 warrantyPeriod;
        uint256 originalPrice;
        string primaryIpfsHash;
        string metadataIpfsHash;
        address currentOwner;
        address originalCreator;
        uint256 tokenId;
        SafetyStatus safetyStatus;
        bool problematic;
        bool exists;
    }

    struct OwnershipRecord {
        address owner;
        uint256 transferredAt;
        uint256 transferPrice;
    }

    struct ServiceRecord {
        string serviceType;
        string description;
        string ipfsHash;
        uint256 servicedAt;
        address addedBy;
    }

    struct DocumentRecord {
        string documentType;
        string ipfsHash;
        uint256 addedAt;
        address addedBy;
    }

    struct StatusRecord {
        WarrantyStatus warrantyStatus;
        SafetyStatus safetyStatus;
        bool problematic;
        uint256 changedAt;
        address changedBy;
    }

    WarrantyNFT public immutable warrantyNFT;
    WarrantyToken public immutable warrantyToken;
    address public immutable feeRecipient;

    uint256 public registrationFee;
    uint256 public transferFee;
    uint256 public registrationReward;
    uint256 public constant CREATOR_ROYALTY_BPS = 1_000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 private _nextProductId = 1;
    mapping(uint256 => Product) private _products;
    mapping(uint256 => OwnershipRecord[]) private _ownershipHistory;
    mapping(uint256 => ServiceRecord[]) private _serviceHistory;
    mapping(uint256 => DocumentRecord[]) private _documents;
    mapping(uint256 => StatusRecord[]) private _statusHistory;
    mapping(bytes32 => bool) private _registeredSerialNumbers;

    event ProductRegistered(
        uint256 indexed productId,
        uint256 indexed tokenId,
        address indexed owner,
        string name,
        string ipfsHash
    );
    event OwnershipTransferred(
        uint256 indexed productId,
        uint256 indexed tokenId,
        address indexed previousOwner,
        address newOwner,
        uint256 transferredAt,
        uint256 transferPrice,
        uint256 creatorFee
    );
    event ServiceRecordAdded(
        uint256 indexed productId,
        uint256 indexed recordIndex,
        string serviceType,
        string ipfsHash,
        uint256 servicedAt
    );
    event WarrantyStatusChanged(
        uint256 indexed productId,
        WarrantyStatus status,
        SafetyStatus safetyStatus,
        uint256 changedAt
    );
    event DocumentAdded(
        uint256 indexed productId,
        uint256 indexed documentIndex,
        string documentType,
        string ipfsHash,
        address indexed addedBy
    );
    event FeesUpdated(uint256 registrationFee, uint256 transferFee, uint256 registrationReward);

    constructor(
        address initialOwner,
        address nftAddress,
        address tokenAddress,
        address initialFeeRecipient,
        uint256 initialRegistrationFee,
        uint256 initialTransferFee,
        uint256 initialRegistrationReward
    ) Ownable(initialOwner) {
        require(nftAddress != address(0), "Invalid NFT contract");
        require(tokenAddress != address(0), "Invalid token contract");
        require(initialFeeRecipient != address(0), "Invalid fee recipient");
        warrantyNFT = WarrantyNFT(nftAddress);
        warrantyToken = WarrantyToken(tokenAddress);
        feeRecipient = initialFeeRecipient;
        registrationFee = initialRegistrationFee;
        transferFee = initialTransferFee;
        registrationReward = initialRegistrationReward;
    }

    function registerProduct(
        string calldata name,
        string calldata category,
        string calldata serialNumber,
        uint256 purchaseDate,
        uint256 warrantyPeriod,
        uint256 originalPrice,
        string calldata documentIpfsHash,
        string calldata metadataIpfsHash,
        address productOwner
    ) external onlyOwner nonReentrant returns (uint256 productId, uint256 tokenId) {
        require(bytes(name).length > 0, "Name is required");
        require(bytes(category).length > 0, "Category is required");
        require(bytes(serialNumber).length > 0, "Serial number is required");
        require(_isIpfsUri(documentIpfsHash), "Invalid document IPFS URI");
        require(_isIpfsUri(metadataIpfsHash), "Invalid metadata IPFS URI");
        require(productOwner != address(0), "Invalid product owner");
        require(purchaseDate > 0 && purchaseDate <= block.timestamp, "Invalid purchase date");
        require(warrantyPeriod > 0, "Warranty period is required");
        require(originalPrice > 0, "Original price is required");
        bytes32 serialHash = keccak256(bytes(serialNumber));
        require(!_registeredSerialNumbers[serialHash], "Serial number already registered");
        _registeredSerialNumbers[serialHash] = true;

        if (registrationFee > 0) {
            IERC20(address(warrantyToken)).safeTransferFrom(msg.sender, feeRecipient, registrationFee);
        }

        productId = _nextProductId++;
        tokenId = warrantyNFT.mintPassport(productOwner, productId, metadataIpfsHash);

        _products[productId] = Product({
            productId: productId,
            name: name,
            category: category,
            serialNumber: serialNumber,
            purchaseDate: purchaseDate,
            warrantyPeriod: warrantyPeriod,
            originalPrice: originalPrice,
            primaryIpfsHash: documentIpfsHash,
            metadataIpfsHash: metadataIpfsHash,
            currentOwner: productOwner,
            originalCreator: msg.sender,
            tokenId: tokenId,
            safetyStatus: SafetyStatus.Normal,
            problematic: false,
            exists: true
        });

        _ownershipHistory[productId].push(OwnershipRecord(productOwner, block.timestamp, originalPrice));
        _documents[productId].push(DocumentRecord("Warranty document", documentIpfsHash, block.timestamp, msg.sender));

        if (registrationReward > 0) {
            warrantyToken.mintReward(productOwner, registrationReward);
        }

        emit ProductRegistered(productId, tokenId, productOwner, name, documentIpfsHash);
        emit DocumentAdded(productId, 0, "Warranty document", documentIpfsHash, msg.sender);
        _recordStatus(productId);
    }

    function transferOwnership(
        uint256 productId,
        address newOwner,
        uint256 transferPrice
    ) external nonReentrant {
        Product storage product = _requireProduct(productId);
        require(msg.sender == product.currentOwner, "Caller is not the product owner");
        require(newOwner != address(0) && newOwner != msg.sender, "Invalid new owner");
        require(transferPrice > 0, "Transfer price is required");

        uint256 creatorFee = (transferPrice * CREATOR_ROYALTY_BPS) / BPS_DENOMINATOR;
        if (transferFee > 0) {
            IERC20(address(warrantyToken)).safeTransferFrom(msg.sender, feeRecipient, transferFee);
        }
        if (creatorFee > 0) {
            IERC20(address(warrantyToken)).safeTransferFrom(msg.sender, product.originalCreator, creatorFee);
        }

        address previousOwner = product.currentOwner;
        product.currentOwner = newOwner;
        _ownershipHistory[productId].push(OwnershipRecord(newOwner, block.timestamp, transferPrice));
        _recordStatus(productId);
        warrantyNFT.managerTransfer(previousOwner, newOwner, product.tokenId);

        emit OwnershipTransferred(
            productId,
            product.tokenId,
            previousOwner,
            newOwner,
            block.timestamp,
            transferPrice,
            creatorFee
        );
    }

    function addDocument(
        uint256 productId,
        string calldata documentType,
        string calldata ipfsHash
    ) external {
        Product storage product = _requireProduct(productId);
        require(msg.sender == product.currentOwner || msg.sender == owner(), "Not authorized");
        require(bytes(documentType).length > 0, "Document type is required");
        require(_isIpfsUri(ipfsHash), "Invalid IPFS URI");

        uint256 index = _documents[productId].length;
        _documents[productId].push(DocumentRecord(documentType, ipfsHash, block.timestamp, msg.sender));
        emit DocumentAdded(productId, index, documentType, ipfsHash, msg.sender);
    }

    function addServiceRecord(
        uint256 productId,
        string calldata serviceType,
        string calldata description,
        string calldata ipfsHash,
        uint256 servicedAt
    ) external {
        Product storage product = _requireProduct(productId);
        require(msg.sender == product.currentOwner || msg.sender == owner(), "Not authorized");
        require(bytes(serviceType).length > 0, "Service type is required");
        require(bytes(description).length > 0, "Description is required");
        require(_isIpfsUri(ipfsHash), "Invalid IPFS URI");
        require(servicedAt > 0 && servicedAt <= block.timestamp, "Invalid service date");

        uint256 index = _serviceHistory[productId].length;
        _serviceHistory[productId].push(
            ServiceRecord(serviceType, description, ipfsHash, servicedAt, msg.sender)
        );
        emit ServiceRecordAdded(productId, index, serviceType, ipfsHash, servicedAt);
    }

    function setSafetyStatus(uint256 productId, SafetyStatus newStatus) external {
        Product storage product = _requireProduct(productId);
        require(msg.sender == product.currentOwner, "Caller is not the product owner");
        product.safetyStatus = newStatus;
        _recordStatus(productId);
    }

    function setProblematic(uint256 productId, bool problematic) external {
        Product storage product = _requireProduct(productId);
        require(msg.sender == product.currentOwner || msg.sender == owner(), "Not authorized");
        product.problematic = problematic;
        _recordStatus(productId);
    }

    function updateFees(
        uint256 newRegistrationFee,
        uint256 newTransferFee,
        uint256 newRegistrationReward
    ) external onlyOwner {
        registrationFee = newRegistrationFee;
        transferFee = newTransferFee;
        registrationReward = newRegistrationReward;
        emit FeesUpdated(newRegistrationFee, newTransferFee, newRegistrationReward);
    }

    function getWarrantyStatus(uint256 productId) public view returns (WarrantyStatus) {
        Product storage product = _requireProduct(productId);
        if (product.problematic || product.safetyStatus != SafetyStatus.Normal) {
            return WarrantyStatus.Problematic;
        }
        if (block.timestamp > product.purchaseDate + product.warrantyPeriod) {
            return WarrantyStatus.Expired;
        }
        if (_ownershipHistory[productId].length > 1) {
            return WarrantyStatus.Transferred;
        }
        return WarrantyStatus.Active;
    }

    function getProduct(uint256 productId) external view returns (Product memory) {
        return _requireProduct(productId);
    }

    function getOwnershipHistory(uint256 productId) external view returns (OwnershipRecord[] memory) {
        _requireProduct(productId);
        return _ownershipHistory[productId];
    }

    function getServiceHistory(uint256 productId) external view returns (ServiceRecord[] memory) {
        _requireProduct(productId);
        return _serviceHistory[productId];
    }

    function getDocuments(uint256 productId) external view returns (DocumentRecord[] memory) {
        _requireProduct(productId);
        return _documents[productId];
    }

    function getStatusHistory(uint256 productId) external view returns (StatusRecord[] memory) {
        _requireProduct(productId);
        return _statusHistory[productId];
    }

    function getOwnershipHistoryPage(
        uint256 productId,
        uint256 offset,
        uint256 limit
    ) external view returns (OwnershipRecord[] memory records, uint256 total) {
        _requireProduct(productId);
        total = _ownershipHistory[productId].length;
        (uint256 start, uint256 end) = _pageBounds(total, offset, limit);
        records = new OwnershipRecord[](end - start);
        for (uint256 i = start; i < end; i++) records[i - start] = _ownershipHistory[productId][i];
    }

    function getServiceHistoryPage(
        uint256 productId,
        uint256 offset,
        uint256 limit
    ) external view returns (ServiceRecord[] memory records, uint256 total) {
        _requireProduct(productId);
        total = _serviceHistory[productId].length;
        (uint256 start, uint256 end) = _pageBounds(total, offset, limit);
        records = new ServiceRecord[](end - start);
        for (uint256 i = start; i < end; i++) records[i - start] = _serviceHistory[productId][i];
    }

    function getDocumentsPage(
        uint256 productId,
        uint256 offset,
        uint256 limit
    ) external view returns (DocumentRecord[] memory records, uint256 total) {
        _requireProduct(productId);
        total = _documents[productId].length;
        (uint256 start, uint256 end) = _pageBounds(total, offset, limit);
        records = new DocumentRecord[](end - start);
        for (uint256 i = start; i < end; i++) records[i - start] = _documents[productId][i];
    }

    function getStatusHistoryPage(
        uint256 productId,
        uint256 offset,
        uint256 limit
    ) external view returns (StatusRecord[] memory records, uint256 total) {
        _requireProduct(productId);
        total = _statusHistory[productId].length;
        (uint256 start, uint256 end) = _pageBounds(total, offset, limit);
        records = new StatusRecord[](end - start);
        for (uint256 i = start; i < end; i++) records[i - start] = _statusHistory[productId][i];
    }

    function getProductsByOwner(address productOwner) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < _nextProductId; i++) {
            if (_products[i].currentOwner == productOwner) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 cursor = 0;
        for (uint256 i = 1; i < _nextProductId; i++) {
            if (_products[i].currentOwner == productOwner) ids[cursor++] = i;
        }
        return ids;
    }

    function totalProducts() external view returns (uint256) {
        return _nextProductId - 1;
    }

    function _requireProduct(uint256 productId) internal view returns (Product storage product) {
        product = _products[productId];
        require(product.exists, "Product does not exist");
    }

    function _recordStatus(uint256 productId) internal {
        Product storage product = _requireProduct(productId);
        WarrantyStatus status = getWarrantyStatus(productId);
        _statusHistory[productId].push(
            StatusRecord(status, product.safetyStatus, product.problematic, block.timestamp, msg.sender)
        );
        emit WarrantyStatusChanged(productId, status, product.safetyStatus, block.timestamp);
    }

    function _isIpfsUri(string calldata value) internal pure returns (bool) {
        bytes calldata data = bytes(value);
        bytes memory prefix = bytes("ipfs://");
        if (data.length <= prefix.length) return false;
        for (uint256 i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }

    function _pageBounds(
        uint256 length,
        uint256 offset,
        uint256 limit
    ) internal pure returns (uint256 start, uint256 end) {
        require(limit > 0 && limit <= 100, "Invalid page size");
        start = offset < length ? offset : length;
        uint256 remaining = length - start;
        end = start + (limit < remaining ? limit : remaining);
    }
}
