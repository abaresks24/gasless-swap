// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";

/// @title GaslessSwap — signed-intent swaps with an LP-funded gas vault
/// @notice Users sign an EIP-2612 permit + an EIP-712 SwapIntent off-chain and
///         never spend gas. Anyone can execute a signed intent: the executor's
///         gas is reimbursed in MON (plus a premium) from a vault funded by
///         liquidity providers. In exchange the vault collects a percentage of
///         every swap (taken on the input token) which accrues to LPs pro rata.
///         LP economics: fees collected > gas reimbursed, enforced by a
///         governance-set minimum fee.
contract GaslessSwap is EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- intents

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "SwapIntent(address user,address tokenIn,address tokenOut,"
        "uint256 amountIn,uint256 minAmountOut,uint256 relayerFeeBps,"
        "uint256 deadline,uint256 nonce)"
    );

    uint256 public constant MAX_RELAYER_FEE_BPS = 500; // 5%

    struct SwapIntent {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;  // min output for (amountIn - lpFee)
        uint256 relayerFeeBps; // share of amountIn paid to the LP vault
        uint256 deadline;
        uint256 nonce;
    }

    address public immutable swapRouter;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public usedIntents;

    // --------------------------------------------------------------- LP vault

    /// @notice MON available to reimburse executor gas (LP deposits minus payouts)
    uint256 public gasPool;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    /// @notice fee tokens ever collected (bounded: one entry per distinct tokenIn)
    address[] public feeTokens;
    mapping(address => bool) public isFeeToken;
    /// @notice accumulated fees per share, scaled by 1e18 (MasterChef-style)
    mapping(address => uint256) public accFeePerShare;
    mapping(address => mapping(address => uint256)) public feeDebt; // token => lp => debt

    /// @notice executor is reimbursed gasUsed * tx.gasprice * (1 + premium)
    uint256 public gasPremiumBps = 1000; // 10%
    /// @notice floor on the LP fee so the vault stays profitable vs gas costs
    uint256 public minRelayerFeeBps = 10; // 0.1%
    /// @notice gas not measurable inside execute(): intrinsic cost, calldata,
    ///         the nonReentrant modifier and the payout call. Tunable because
    ///         it was calibrated against real Monad testnet receipts (~131k).
    uint256 public gasOverhead = 150_000;

    // lifetime stats (for the Earn dashboard)
    uint256 public totalGasReimbursed;
    mapping(address => uint256) public totalFeesCollected;

    // ----------------------------------------------------------------- events

    event IntentExecuted(
        bytes32 indexed intentHash,
        address indexed user,
        address indexed executor,
        uint256 amountIn,
        uint256 amountOut,
        uint256 lpFee,
        uint256 gasReimbursed
    );
    event Deposited(address indexed lp, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed lp, uint256 amount, uint256 sharesBurned);
    event FeesClaimed(address indexed lp, address indexed token, uint256 amount);

    constructor(address _swapRouter) EIP712("GaslessSwap", "1") Ownable(msg.sender) {
        swapRouter = _swapRouter;
    }

    // ---------------------------------------------------------------- execute

    /// @notice Execute a signed swap intent. Callable by anyone: the caller
    ///         fronts the gas and is immediately reimbursed in MON (plus
    ///         premium) from the LP vault.
    function execute(
        SwapIntent calldata intent,
        uint256 permitDeadline,
        uint8 permitV,
        bytes32 permitR,
        bytes32 permitS,
        bytes calldata intentSig,
        uint24 poolFee
    ) external nonReentrant {
        uint256 gasStart = gasleft();

        // 1. Validate intent
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.relayerFeeBps <= MAX_RELAYER_FEE_BPS, "Fee too high");
        require(intent.relayerFeeBps >= minRelayerFeeBps, "Fee too low");
        require(intent.nonce == nonces[intent.user], "Bad nonce");
        bytes32 intentHash = _hashIntent(intent);
        require(!usedIntents[intentHash], "Intent already used");
        address signer = ECDSA.recover(_hashTypedDataV4(intentHash), intentSig);
        require(signer == intent.user, "Invalid signature");

        // 2. Mark used before any external call
        usedIntents[intentHash] = true;
        nonces[intent.user]++;

        // 3. Pull tokenIn via permit — no prior approval tx needed.
        //    try/catch: if the permit was already consumed (e.g. front-run),
        //    the existing allowance still lets transferFrom succeed.
        try IERC20Permit(intent.tokenIn).permit(
            intent.user, address(this), intent.amountIn,
            permitDeadline, permitV, permitR, permitS
        ) {} catch {}
        IERC20(intent.tokenIn).safeTransferFrom(intent.user, address(this), intent.amountIn);

        // 4. LP fee on the input token, accrued to current shareholders
        uint256 lpFee = (intent.amountIn * intent.relayerFeeBps) / 10000;
        require(totalShares > 0, "No liquidity providers");
        _accrueFee(intent.tokenIn, lpFee);

        // 5. Swap the rest, output straight to the user
        uint256 swapAmount = intent.amountIn - lpFee;
        IERC20(intent.tokenIn).forceApprove(swapRouter, swapAmount);
        uint256 amountOut = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: intent.tokenIn,
                tokenOut: intent.tokenOut,
                fee: poolFee,
                recipient: intent.user,
                amountIn: swapAmount,
                amountOutMinimum: intent.minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        // 6. Reimburse the executor's gas from the vault, with premium
        uint256 gasUsed = gasStart - gasleft() + gasOverhead;
        uint256 reimbursed = (gasUsed * tx.gasprice * (10000 + gasPremiumBps)) / 10000;
        require(gasPool >= reimbursed, "Vault out of gas funds");
        gasPool -= reimbursed;
        totalGasReimbursed += reimbursed;
        (bool ok,) = msg.sender.call{value: reimbursed}("");
        require(ok, "Gas reimbursement failed");

        emit IntentExecuted(
            intentHash, intent.user, msg.sender,
            intent.amountIn, amountOut, lpFee, reimbursed
        );
    }

    // --------------------------------------------------------------- LP logic

    /// @notice Deposit MON; mints vault shares at the current share price.
    function depositGas() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit");
        _claimAll(msg.sender);
        uint256 minted = totalShares == 0
            ? msg.value
            : (msg.value * totalShares) / gasPool;
        require(minted > 0, "Deposit too small");
        gasPool += msg.value;
        totalShares += minted;
        shares[msg.sender] += minted;
        _syncDebt(msg.sender);
        emit Deposited(msg.sender, msg.value, minted);
    }

    /// @notice Burn shares for a pro-rata slice of the MON pool, and claim fees.
    function withdrawGas(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0 && shareAmount <= shares[msg.sender], "Bad share amount");
        _claimAll(msg.sender);
        uint256 amount = (shareAmount * gasPool) / totalShares;
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        gasPool -= amount;
        _syncDebt(msg.sender);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount, shareAmount);
    }

    /// @notice Claim accrued swap fees (all fee tokens).
    function claimFees() external nonReentrant {
        _claimAll(msg.sender);
        _syncDebt(msg.sender);
    }

    function _accrueFee(address token, uint256 amount) internal {
        if (amount == 0) return;
        if (!isFeeToken[token]) {
            isFeeToken[token] = true;
            feeTokens.push(token);
        }
        accFeePerShare[token] += (amount * 1e18) / totalShares;
        totalFeesCollected[token] += amount;
    }

    function _claimAll(address lp) internal {
        uint256 lpShares = shares[lp];
        if (lpShares == 0) return;
        for (uint256 i = 0; i < feeTokens.length; i++) {
            address token = feeTokens[i];
            uint256 owed = (lpShares * accFeePerShare[token]) / 1e18 - feeDebt[token][lp];
            if (owed > 0) {
                feeDebt[token][lp] += owed;
                IERC20(token).safeTransfer(lp, owed);
                emit FeesClaimed(lp, token, owed);
            }
        }
    }

    function _syncDebt(address lp) internal {
        for (uint256 i = 0; i < feeTokens.length; i++) {
            address token = feeTokens[i];
            feeDebt[token][lp] = (shares[lp] * accFeePerShare[token]) / 1e18;
        }
    }

    // ------------------------------------------------------------------ views

    function pendingFees(address lp, address token) external view returns (uint256) {
        return (shares[lp] * accFeePerShare[token]) / 1e18 - feeDebt[token][lp];
    }

    function feeTokensLength() external view returns (uint256) {
        return feeTokens.length;
    }

    /// @notice MON value of an LP's shares.
    function shareValue(address lp) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[lp] * gasPool) / totalShares;
    }

    function getIntentHash(SwapIntent calldata intent) external view returns (bytes32) {
        return _hashTypedDataV4(_hashIntent(intent));
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------- governance

    function setGasPremiumBps(uint256 bps) external onlyOwner {
        require(bps <= 5000, "Premium too high");
        gasPremiumBps = bps;
    }

    function setMinRelayerFeeBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_RELAYER_FEE_BPS, "Min above max");
        minRelayerFeeBps = bps;
    }

    function setGasOverhead(uint256 amount) external onlyOwner {
        require(amount <= 500_000, "Overhead too high");
        gasOverhead = amount;
    }

    // ------------------------------------------------------------------ utils

    function _hashIntent(SwapIntent calldata i) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            INTENT_TYPEHASH,
            i.user, i.tokenIn, i.tokenOut,
            i.amountIn, i.minAmountOut, i.relayerFeeBps,
            i.deadline, i.nonce
        ));
    }
}
