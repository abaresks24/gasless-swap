import { parseAbi } from 'viem'

export const CHAIN_ID = 10143
export const RPC_URL = 'https://testnet-rpc.monad.xyz'
export const EXPLORER_URL = 'https://testnet.monadexplorer.com'

export const GASLESSSWAP_ADDRESS = import.meta.env.VITE_GASLESSSWAP_ADDRESS
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS
export const WETH_ADDRESS = import.meta.env.VITE_WETH_ADDRESS
export const ROUTER_ADDRESS = import.meta.env.VITE_ROUTER_ADDRESS
export const QUOTER_ADDRESS = import.meta.env.VITE_QUOTER_ADDRESS
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_DEPLOY_BLOCK ?? 0)

export const RELAYER_FEE_BPS = 30n // 0.3%
export const SLIPPAGE_BPS = 50n // 0.5%
export const POOL_FEE = 3000

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
  'function name() view returns (string)',
  'function mint(address to, uint256 amount)',
])

// QuoterV2 is technically nonpayable (it simulates the swap and reverts),
// but declaring it view lets viem use a plain eth_call.
export const quoterAbi = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

export const gaslessSwapAbi = parseAbi([
  'struct SwapIntent { address user; address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; uint256 relayerFeeBps; uint256 deadline; uint256 nonce; }',
  'function nonces(address) view returns (uint256)',
  'function execute(SwapIntent intent, uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS, bytes intentSig, uint24 poolFee)',
  'function getIntentHash(SwapIntent intent) view returns (bytes32)',
  // LP vault
  'function depositGas() payable',
  'function withdrawGas(uint256 shareAmount)',
  'function claimFees()',
  'function gasPool() view returns (uint256)',
  'function totalShares() view returns (uint256)',
  'function shares(address) view returns (uint256)',
  'function shareValue(address) view returns (uint256)',
  'function pendingFees(address lp, address token) view returns (uint256)',
  'function totalGasReimbursed() view returns (uint256)',
  'function totalFeesCollected(address) view returns (uint256)',
  'function gasPremiumBps() view returns (uint256)',
  'function minRelayerFeeBps() view returns (uint256)',
  'event IntentExecuted(bytes32 indexed intentHash, address indexed user, address indexed executor, uint256 amountIn, uint256 amountOut, uint256 lpFee, uint256 gasReimbursed)',
  'event Deposited(address indexed lp, uint256 amount, uint256 sharesMinted)',
  'event Withdrawn(address indexed lp, uint256 amount, uint256 sharesBurned)',
])
