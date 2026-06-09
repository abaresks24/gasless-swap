import { parseAbi } from 'viem'

export const CHAIN_ID = 10143
export const RPC_URL = 'https://testnet-rpc.monad.xyz'
export const EXPLORER_URL = 'https://testnet.monadexplorer.com'

export const GASLESSSWAP_ADDRESS = import.meta.env.VITE_GASLESSSWAP_ADDRESS
export const QUOTER_ADDRESS = import.meta.env.VITE_QUOTER_ADDRESS
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_DEPLOY_BLOCK ?? 0)

export const RELAYER_FEE_BPS = 30n // 0.3%
export const SLIPPAGE_BPS = 50n // 0.5%
export const POOL_FEE = 3000

// permit: EIP-712 domain used by the token's EIP-2612 implementation.
// USDC is the canonical Circle FiatToken on Monad testnet (domain version "2",
// no public mint — get it from faucet.circle.com). wETH/wBTC are test tokens
// with permit and open mint (the executor pays the faucet gas).
export const TOKENS = {
  USDC: {
    symbol: 'USDC',
    address: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
    decimals: 6,
    permit: { name: 'USDC', version: '2' },
    mintable: false,
    faucetUrl: 'https://faucet.circle.com',
    defaultAmount: '10',
  },
  wETH: {
    symbol: 'wETH',
    address: '0x8AdA6dca334543B2806D467Bd3B58c37aa41F0CA',
    decimals: 18,
    permit: { name: 'Wrapped Ether', version: '1' },
    mintable: true,
    faucetAmount: 1_000_000_000_000_000_000n, // 1 wETH
    defaultAmount: '0.01',
  },
  wBTC: {
    symbol: 'wBTC',
    address: '0x17A9432C233b6d42AFb237c3960dF7A87BEE0044',
    decimals: 8,
    permit: { name: 'Wrapped Bitcoin', version: '1' },
    mintable: true,
    faucetAmount: 10_000_000n, // 0.1 wBTC
    defaultAmount: '0.001',
  },
}

export const TOKEN_LIST = Object.values(TOKENS)
export const tokenByAddress = (address) =>
  TOKEN_LIST.find((t) => t.address.toLowerCase() === (address ?? '').toLowerCase())

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
  'event IntentExecuted(bytes32 indexed intentHash, address indexed user, address indexed executor, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 lpFee, uint256 gasReimbursed)',
  'event Deposited(address indexed lp, uint256 amount, uint256 sharesMinted)',
  'event Withdrawn(address indexed lp, uint256 amount, uint256 sharesBurned)',
])
