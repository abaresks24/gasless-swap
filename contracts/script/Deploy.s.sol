// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GaslessSwap} from "../src/GaslessSwap.sol";

/// @notice Deploys GaslessSwap (LP gas vault edition) against the live
///         Uniswap V3 SwapRouter02 on Monad testnet and seeds the vault
///         with an initial MON deposit so swaps work immediately.
///         Token + pool deployment lives in frontend/scripts/deploy-univ3.mjs.
contract Deploy is Script {
    address constant SWAP_ROUTER02 = 0x3d28251fC82ad86C9Dd3E496d5560C66e5eb3F55;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        GaslessSwap swap = new GaslessSwap(SWAP_ROUTER02);
        swap.depositGas{value: 2 ether}(); // initial LP so the demo works out of the box

        vm.stopBroadcast();

        console.log("GaslessSwap:", address(swap));
        console.log("gasPool:    ", swap.gasPool());
    }
}
