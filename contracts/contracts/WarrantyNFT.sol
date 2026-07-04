// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract WarrantyNFT is ERC721, Ownable {
    address public manager;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => uint256) public tokenToProductId;
    mapping(uint256 => string) private _tokenUris;

    event ManagerUpdated(address indexed previousManager, address indexed newManager);

    modifier onlyManager() {
        require(msg.sender == manager, "Caller is not the manager");
        _;
    }

    constructor(address initialOwner) ERC721("Warranty Passport", "WPT") Ownable(initialOwner) {}

    function setManager(address newManager) external onlyOwner {
        require(newManager != address(0), "Invalid manager");
        require(manager == address(0), "Manager already configured");
        emit ManagerUpdated(manager, newManager);
        manager = newManager;
    }

    function mintPassport(
        address productOwner,
        uint256 productId,
        string calldata metadataUri
    ) external onlyManager returns (uint256 tokenId) {
        require(productOwner != address(0), "Invalid product owner");
        tokenId = _nextTokenId++;
        tokenToProductId[tokenId] = productId;
        _tokenUris[tokenId] = metadataUri;
        _safeMint(productOwner, tokenId);
    }

    function managerTransfer(address from, address to, uint256 tokenId) external onlyManager {
        require(to != address(0), "Invalid new owner");
        _safeTransfer(from, to, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenUris[tokenId];
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address previousOwner) {
        address currentOwner = _ownerOf(tokenId);
        if (currentOwner != address(0) && to != address(0)) {
            require(msg.sender == manager, "Transfers must use WarrantyManager");
        }
        return super._update(to, tokenId, auth);
    }
}
