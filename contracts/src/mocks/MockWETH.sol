// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Demo output token (18 decimals, open mint).
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "wETH") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
