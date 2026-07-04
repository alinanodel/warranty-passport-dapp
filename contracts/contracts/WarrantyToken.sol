// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract WarrantyToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_SUPPLY = 10_000_000 ether;

    constructor(address initialAdmin, uint256 initialSupply) ERC20("Warranty Token", "WTY") {
        require(initialAdmin != address(0), "Invalid admin");
        require(initialSupply <= MAX_SUPPLY, "Initial supply exceeds cap");
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialAdmin);
        _mint(initialAdmin, initialSupply);
    }

    function mintReward(address recipient, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
        _mint(recipient, amount);
    }
}
