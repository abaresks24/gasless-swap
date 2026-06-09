// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GaslessSwap} from "../src/GaslessSwap.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";

interface IUniswapV3FactoryMin {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address);
}

interface IUniswapV3PoolMin {
    function initialize(uint160 sqrtPriceX96) external;
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
}

/// @notice Tests run against the REAL Uniswap V3 contracts (official build
///         artifacts from the Uniswap v3-core and swap-router-contracts npm
///         packages), not mocks: factory + pool + SwapRouter02.
contract GaslessSwapTest is Test {
    GaslessSwap swap;
    MockUSDC usdc; // test token, EIP-2612
    MockWETH weth; // test token
    address factory;
    address router;
    address pool;

    uint256 userPk = 0xA11CE;
    address user;
    address executor = makeAddr("executor");
    address lp = makeAddr("lp");
    address lp2 = makeAddr("lp2");

    // pool price: 1 USDC (1e6) = 0.0004 wETH (4e14) -> sqrtPriceX96 = 20000 << 96
    uint160 constant SQRT_PRICE_X96 = uint160(20000) << 96;
    uint128 constant LIQUIDITY = 2e16; // ~1M USDC / ~400 wETH full range

    bytes32 constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        user = vm.addr(userPk);
        usdc = new MockUSDC();
        weth = new MockWETH();

        // Real Uniswap V3 stack from official artifacts
        factory = deployCode("test/artifacts/UniswapV3Factory.json");
        router = deployCode(
            "test/artifacts/SwapRouter02.json",
            abi.encode(address(0), factory, address(0), address(weth))
        );

        // Real pool with full-range liquidity. sqrtPrice is token1-per-token0,
        // so it depends on address ordering; the same L gives ~1M USDC / ~400 wETH
        // either way.
        pool = IUniswapV3FactoryMin(factory).createPool(address(usdc), address(weth), 3000);
        uint160 sqrtPriceX96 = address(usdc) < address(weth)
            ? SQRT_PRICE_X96
            : uint160((uint256(1) << 96) / 20000);
        IUniswapV3PoolMin(pool).initialize(sqrtPriceX96);
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 1_000 ether);
        IUniswapV3PoolMin(pool).mint(address(this), -887220, 887220, LIQUIDITY, "");

        swap = new GaslessSwap(router);

        usdc.mint(user, 1000e6);
        vm.deal(user, 0); // user has strictly zero gas token
        vm.deal(executor, 1 ether);
        vm.deal(lp, 10 ether);
        vm.deal(lp2, 10 ether);

        // LP seeds the gas vault
        vm.prank(lp);
        swap.depositGas{value: 5 ether}();
    }

    /// Uniswap V3 mint callback: pay the pool what it asks for, in pool token order.
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        (address token0, address token1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        if (amount0Owed > 0) IERC20(token0).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) IERC20(token1).transfer(msg.sender, amount1Owed);
    }

    // ------------------------------------------------------------- helpers

    function _defaultIntent() internal view returns (GaslessSwap.SwapIntent memory) {
        return GaslessSwap.SwapIntent({
            user: user,
            tokenIn: address(usdc),
            tokenOut: address(weth),
            amountIn: 100e6,
            minAmountOut: 38e15, // 0.038 wETH (room for pool fee + price impact)
            relayerFeeBps: 30,
            deadline: block.timestamp + 3600,
            nonce: swap.nonces(user)
        });
    }

    function _signPermit(uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_TYPEHASH, user, address(swap), value, usdc.nonces(user), deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(userPk, digest);
    }

    function _signIntent(GaslessSwap.SwapIntent memory intent) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, swap.getIntentHash(intent));
        return abi.encodePacked(r, s, v);
    }

    function _execute(GaslessSwap.SwapIntent memory intent) internal {
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory intentSig = _signIntent(intent);
        vm.prank(executor, executor); // sets tx.origin too, for tx.gasprice realism
        swap.execute(intent, permitDeadline, pv, pr, ps, intentSig, 3000);
    }

    // ---------------------------------------------------------------- tests

    function testGaslessSwapThroughRealPool() public {
        vm.txGasPrice(1 gwei);
        uint256 executorBalBefore = executor.balance;

        _execute(_defaultIntent());

        // fee = 0.3% of 100 USDC = 0.30 USDC, swapped 99.7 USDC
        assertEq(usdc.balanceOf(user), 900e6, "user USDC debited");
        // real pool math: ~99.7 * 0.0004 * (1 - 0.3% pool fee) minus price impact
        uint256 outWeth = weth.balanceOf(user);
        assertGt(outWeth, 39e15, "user got ~0.0397 wETH");
        assertLt(outWeth, 40e15, "output bounded by ideal rate");
        assertEq(user.balance, 0, "user spent zero gas");

        // vault collected the USDC fee
        assertEq(swap.totalFeesCollected(address(usdc)), 0.3e6, "0.30 USDC fee");
        // executor got reimbursed more than zero (gas + 10% premium)
        assertGt(executor.balance, executorBalBefore, "executor net positive");
        assertGt(swap.totalGasReimbursed(), 0);
        // vault MON decreased by exactly the reimbursement
        assertEq(swap.gasPool(), 5 ether - swap.totalGasReimbursed());
    }

    function testLpEarnsMoreThanGasPaid() public {
        vm.txGasPrice(50 gwei); // generous testnet gas price
        _execute(_defaultIntent());

        // LP economics: 0.30 USDC fee vs gas reimbursed in MON.
        // At 50 gwei and ~500k gas, reimbursement ~= 0.028 MON.
        // With MON ~= 1 USD on testnet assumptions: 0.30 > 0.028.
        uint256 feeUsdc = swap.totalFeesCollected(address(usdc)); // 6 decimals
        uint256 gasMon = swap.totalGasReimbursed(); // 18 decimals
        // compare in common 18-dec "dollar" units (1 USDC = 1e12 wei-units, MON = $1)
        assertGt(feeUsdc * 1e12, gasMon, "LP fee value must exceed gas paid");
    }

    function testLpFeeAccrualAndClaim() public {
        vm.txGasPrice(1 gwei);
        _execute(_defaultIntent());

        // single LP owns 100% of the 0.30 USDC fee
        assertEq(swap.pendingFees(lp, address(usdc)), 0.3e6);
        uint256 before = usdc.balanceOf(lp);
        vm.prank(lp);
        swap.claimFees();
        assertEq(usdc.balanceOf(lp) - before, 0.3e6);
        assertEq(swap.pendingFees(lp, address(usdc)), 0);
    }

    function testTwoLpsProRata() public {
        vm.txGasPrice(1 gwei);
        // lp2 joins with the same MON amount as lp's remaining pool value
        vm.prank(lp2);
        swap.depositGas{value: 5 ether}();

        _execute(_defaultIntent());

        // 50/50 split of the 0.30 USDC fee
        assertEq(swap.pendingFees(lp, address(usdc)), 0.15e6);
        assertEq(swap.pendingFees(lp2, address(usdc)), 0.15e6);
    }

    function testLateLpGetsNoPastFees() public {
        vm.txGasPrice(1 gwei);
        _execute(_defaultIntent());
        // lp2 deposits AFTER the swap: no claim on past fees
        vm.prank(lp2);
        swap.depositGas{value: 5 ether}();
        assertEq(swap.pendingFees(lp2, address(usdc)), 0);
        assertEq(swap.pendingFees(lp, address(usdc)), 0.3e6);
    }

    function testWithdrawGas() public {
        vm.txGasPrice(1 gwei);
        _execute(_defaultIntent());

        uint256 poolAfterSwap = swap.gasPool();
        uint256 lpShares = swap.shares(lp);
        uint256 balBefore = lp.balance;
        vm.prank(lp);
        swap.withdrawGas(lpShares);
        // LP got the whole remaining pool (sole LP) + the USDC fee auto-claimed
        assertEq(lp.balance - balBefore, poolAfterSwap);
        assertEq(usdc.balanceOf(lp), 0.3e6);
        assertEq(swap.gasPool(), 0);
        assertEq(swap.totalShares(), 0);
    }

    function testExecuteRevertsWithoutLps() public {
        GaslessSwap fresh = new GaslessSwap(router);
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        intent.nonce = 0;
        uint256 permitDeadline = block.timestamp + 3600;
        // permit signed for the fresh contract
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_TYPEHASH, user, address(fresh), intent.amountIn, usdc.nonces(user), permitDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 pv, bytes32 pr, bytes32 ps) = vm.sign(userPk, digest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, fresh.getIntentHash(intent));
        vm.prank(executor);
        vm.expectRevert("No liquidity providers");
        fresh.execute(intent, permitDeadline, pv, pr, ps, abi.encodePacked(r, s, v), 3000);
    }

    function testVaultOutOfGasFunds() public {
        // drain the vault to a dust balance
        vm.txGasPrice(1 gwei);
        uint256 lpShares = swap.shares(lp);
        vm.prank(lp);
        swap.withdrawGas(lpShares - 10); // leaves ~10 wei-shares of MON

        vm.txGasPrice(1000 gwei);
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory intentSig = _signIntent(intent);
        vm.prank(executor);
        vm.expectRevert("Vault out of gas funds");
        swap.execute(intent, permitDeadline, pv, pr, ps, intentSig, 3000);
    }

    function testReplayRejected() public {
        vm.txGasPrice(1 gwei);
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory intentSig = _signIntent(intent);

        vm.prank(executor);
        swap.execute(intent, permitDeadline, pv, pr, ps, intentSig, 3000);

        vm.prank(executor);
        vm.expectRevert("Bad nonce");
        swap.execute(intent, permitDeadline, pv, pr, ps, intentSig, 3000);
    }

    function testSecondSwapWithNextNonce() public {
        vm.txGasPrice(1 gwei);
        _execute(_defaultIntent());
        _execute(_defaultIntent()); // re-reads nonces(user) == 1
        assertEq(swap.nonces(user), 2);
        assertEq(usdc.balanceOf(user), 800e6);
    }

    function testFeeBounds() public {
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        intent.relayerFeeBps = 501;
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory sig = _signIntent(intent);
        vm.prank(executor);
        vm.expectRevert("Fee too high");
        swap.execute(intent, permitDeadline, pv, pr, ps, sig, 3000);

        intent.relayerFeeBps = 5; // below the 10 bps floor
        sig = _signIntent(intent);
        vm.prank(executor);
        vm.expectRevert("Fee too low");
        swap.execute(intent, permitDeadline, pv, pr, ps, sig, 3000);
    }

    function testInvalidSignature() public {
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, swap.getIntentHash(intent));
        vm.prank(executor);
        vm.expectRevert("Invalid signature");
        swap.execute(intent, permitDeadline, pv, pr, ps, abi.encodePacked(r, s, v), 3000);
    }

    function testTamperedIntentRejected() public {
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory intentSig = _signIntent(intent);
        intent.minAmountOut = 0; // executor tries to relax slippage after signing
        vm.prank(executor);
        vm.expectRevert("Invalid signature");
        swap.execute(intent, permitDeadline, pv, pr, ps, intentSig, 3000);
    }

    function testExpiredIntent() public {
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        intent.deadline = block.timestamp - 1;
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory sig = _signIntent(intent);
        vm.prank(executor);
        vm.expectRevert("Intent expired");
        swap.execute(intent, permitDeadline, pv, pr, ps, sig, 3000);
    }

    function testSlippageProtection() public {
        GaslessSwap.SwapIntent memory intent = _defaultIntent();
        intent.minAmountOut = 41e15; // demands more than the pool can give
        uint256 permitDeadline = block.timestamp + 3600;
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(intent.amountIn, permitDeadline);
        bytes memory sig = _signIntent(intent);
        vm.prank(executor);
        vm.expectRevert(bytes("Too little received"));
        swap.execute(intent, permitDeadline, pv, pr, ps, sig, 3000);
    }
}
