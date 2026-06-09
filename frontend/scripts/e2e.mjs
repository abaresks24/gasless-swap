// End-to-end gasless swap + LP vault economics against Monad testnet.
// Mirrors the frontend flow exactly. Run from frontend/: node scripts/e2e.mjs
//
// Proves, on-chain:
//   1. a freshly generated wallet with 0 MON swaps USDC -> wETH
//   2. the executor fronts the gas and is reimbursed +10% by the vault
//   3. the LP vault collects the 0.3% fee, claimable pro rata
import { createPublicClient, createWalletClient, http, parseSignature, parseAbi, formatUnits, formatEther } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { requireEnv } from './env.mjs'

const RPC = 'https://testnet-rpc.monad.xyz'
const USDC = requireEnv('VITE_USDC_ADDRESS')
const WETH = requireEnv('VITE_WETH_ADDRESS')
const SWAP = requireEnv('VITE_GASLESSSWAP_ADDRESS')
const QUOTER = requireEnv('VITE_QUOTER_ADDRESS')
const DEPLOYER_PK = requireEnv('DEPLOYER_PRIVATE_KEY')
const EXECUTOR_PK = requireEnv('VITE_RELAYER_PRIVATE_KEY')

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
  'function mint(address,uint256)',
])
const quoterAbi = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])
const swapAbi = parseAbi([
  'struct SwapIntent { address user; address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; uint256 relayerFeeBps; uint256 deadline; uint256 nonce; }',
  'function nonces(address) view returns (uint256)',
  'function execute(SwapIntent intent, uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS, bytes intentSig, uint24 poolFee)',
  'function gasPool() view returns (uint256)',
  'function totalGasReimbursed() view returns (uint256)',
  'function totalFeesCollected(address) view returns (uint256)',
  'function pendingFees(address lp, address token) view returns (uint256)',
])

const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) })
const deployerAccount = privateKeyToAccount(DEPLOYER_PK)
const deployer = createWalletClient({ account: deployerAccount, chain: monadTestnet, transport: http(RPC) })
const executorAccount = privateKeyToAccount(EXECUTOR_PK)
const executor = createWalletClient({ account: executorAccount, chain: monadTestnet, transport: http(RPC) })

// Fresh user — provably zero MON, ever.
const userAccount = privateKeyToAccount(generatePrivateKey())
const user = createWalletClient({ account: userAccount, chain: monadTestnet, transport: http(RPC) })
console.log('user:', userAccount.address, '| MON balance:', formatEther(await pub.getBalance({ address: userAccount.address })))

// Vault state before
const [poolBefore, gasBefore, feesBefore] = await Promise.all([
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'gasPool' }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'totalGasReimbursed' }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'totalFeesCollected', args: [USDC] }),
])
console.log(`vault before: ${formatEther(poolBefore)} MON | fees ${formatUnits(feesBefore, 6)} USDC`)

// Setup: deployer mints 500 USDC to user (in the app: "Get test USDC")
let hash = await deployer.writeContract({ address: USDC, abi: erc20Abi, functionName: 'mint', args: [userAccount.address, 500_000_000n] })
await pub.waitForTransactionReceipt({ hash })
console.log('minted 500 USDC to user')

const amountIn = 100_000_000n // 100 USDC
const feeBps = 30n
const netIn = amountIn - (amountIn * feeBps) / 10000n
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

// 1. Sign EIP-2612 permit (no gas)
const permitNonce = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'nonces', args: [userAccount.address] })
const permitSig = await user.signTypedData({
  domain: { name: 'USD Coin', version: '1', chainId: 10143, verifyingContract: USDC },
  types: { Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ]},
  primaryType: 'Permit',
  message: { owner: userAccount.address, spender: SWAP, value: amountIn, nonce: permitNonce, deadline },
})
console.log('permit signed')

// 2. Sign EIP-712 SwapIntent (no gas) — fee is on the input, quote the net amount
const intentNonce = await pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'nonces', args: [userAccount.address] })
const [quote] = await pub.readContract({
  address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: USDC, tokenOut: WETH, amountIn: netIn, fee: 3000, sqrtPriceLimitX96: 0n }],
})
console.log('QuoterV2 quote (net of LP fee):', formatUnits(quote, 18), 'wETH')
const intent = {
  user: userAccount.address, tokenIn: USDC, tokenOut: WETH,
  amountIn, minAmountOut: (quote * 995n) / 1000n,
  relayerFeeBps: feeBps, deadline, nonce: intentNonce,
}
const intentSig = await user.signTypedData({
  domain: { name: 'GaslessSwap', version: '1', chainId: 10143, verifyingContract: SWAP },
  types: { SwapIntent: [
    { name: 'user', type: 'address' }, { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'minAmountOut', type: 'uint256' },
    { name: 'relayerFeeBps', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
  ]},
  primaryType: 'SwapIntent',
  message: intent,
})
console.log('intent signed')

// 3. Executor submits — fronts gas, gets reimbursed +10% by the vault
const executorMonBefore = await pub.getBalance({ address: executorAccount.address })
const { v, r, s } = parseSignature(permitSig)
const t0 = Date.now()
hash = await executor.writeContract({
  address: SWAP, abi: swapAbi, functionName: 'execute',
  args: [intent, deadline, Number(v), r, s, intentSig, 3000],
  gas: 600_000n, // Monad charges the gas limit — keep it tight to stay under the reimbursement
})
const receipt = await pub.waitForTransactionReceipt({ hash })
console.log(`executed in ${Date.now() - t0}ms — status: ${receipt.status} — tx: ${hash}`)

const [userWeth, userUsdc, userMon, executorMonAfter, poolAfter, gasAfter, feesAfter, lpPending] = await Promise.all([
  pub.readContract({ address: WETH, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] }),
  pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [userAccount.address] }),
  pub.getBalance({ address: userAccount.address }),
  pub.getBalance({ address: executorAccount.address }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'gasPool' }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'totalGasReimbursed' }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'totalFeesCollected', args: [USDC] }),
  pub.readContract({ address: SWAP, abi: swapAbi, functionName: 'pendingFees', args: [deployerAccount.address, USDC] }),
])

const gasReimbursed = gasAfter - gasBefore
const txGasCost = receipt.gasUsed * receipt.effectiveGasPrice
console.log('--- user ---')
console.log('wETH received:', formatUnits(userWeth, 18), '| USDC left:', formatUnits(userUsdc, 6), '| MON spent:', formatEther(userMon))
console.log('--- executor ---')
console.log('tx gas cost:', formatEther(txGasCost), 'MON | reimbursed:', formatEther(gasReimbursed), 'MON | net:', formatEther(executorMonAfter - executorMonBefore), 'MON')
console.log('--- LP vault ---')
console.log('MON pool:', formatEther(poolBefore), '->', formatEther(poolAfter))
console.log('fee collected this swap:', formatUnits(feesAfter - feesBefore, 6), 'USDC | LP (deployer) pending fees:', formatUnits(lpPending, 6), 'USDC')

const checks = [
  [userWeth > 0n, 'user received wETH'],
  [userMon === 0n, 'user spent zero MON'],
  [executorMonAfter > executorMonBefore, 'executor net positive (premium)'],
  [feesAfter - feesBefore === 300000n, 'vault collected 0.30 USDC fee'],
  [poolBefore - poolAfter === gasReimbursed, 'vault paid exactly the reimbursement'],
]
let ok = true
for (const [pass, label] of checks) {
  console.log(`${pass ? '✅' : '❌'} ${label}`)
  if (!pass) ok = false
}
if (!ok) { console.error('E2E FAILED'); process.exit(1) }
console.log('E2E PASSED ✅')
