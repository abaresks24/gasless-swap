// Creates the Circle-USDC/wETH 0.3% pool on our Uniswap V3 deployment with
// single-sided wETH liquidity (we cannot mint Circle USDC, and the demo swap
// direction USDC -> wETH only consumes the wETH side).
// Run from frontend/: node scripts/seed-pool-circle-usdc.mjs
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { requireEnv } from './env.mjs'

const RPC = 'https://testnet-rpc.monad.xyz'
const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3' // canonical Circle testnet USDC
const WETH = requireEnv('VITE_WETH_ADDRESS')
const POSITION_MANAGER = '0xcfb921985158e2f4352f5d5eabdddc4516a01ac8'
const QUOTER = requireEnv('VITE_QUOTER_ADDRESS')
const DEPLOYER_PK = requireEnv('DEPLOYER_PRIVATE_KEY')

const npmAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json', import.meta.url))).abi
const quoterAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json', import.meta.url))).abi
const erc20 = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])

const account = privateKeyToAccount(DEPLOYER_PK)
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 })
const pub = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 1500 })
const wallet = createWalletClient({ account, chain: monadTestnet, transport })

let nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' })
async function tx(params) {
  const hash = await wallet.writeContract({ ...params, nonce: nonce++ })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`tx reverted: ${params.functionName}`)
  await new Promise((r) => setTimeout(r, 500))
  return receipt
}

// Pool price 1 USDC = 0.0004 wETH. USDC (0x534b…) < wETH (0xF41e…) -> token0 = USDC,
// price token1/token0 raw = 4e14/1e6 = 4e8, sqrtPriceX96 = 20000 << 96 (tick ~198080).
const sqrtPriceX96 = 20000n << 96n
await tx({
  address: POSITION_MANAGER, abi: npmAbi,
  functionName: 'createAndInitializePoolIfNecessary',
  args: [USDC, WETH, 3000, sqrtPriceX96],
})
console.log('pool created/initialized')

// Single-sided wETH range strictly below the current tick: as USDC sells push
// the price down, this wETH is what the pool pays out.
const wethAmount = 300n * 10n ** 18n
await tx({ address: WETH, abi: erc20, functionName: 'mint', args: [account.address, wethAmount] })
await tx({ address: WETH, abi: erc20, functionName: 'approve', args: [POSITION_MANAGER, wethAmount] })
await tx({
  address: POSITION_MANAGER, abi: npmAbi,
  functionName: 'mint',
  args: [{
    token0: USDC, token1: WETH, fee: 3000,
    tickLower: 180000, tickUpper: 198060,
    amount0Desired: 0n, amount1Desired: wethAmount,
    amount0Min: 0n, amount1Min: 0n,
    recipient: account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }],
})
console.log('single-sided wETH liquidity minted')

const { result } = await pub.simulateContract({
  address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: USDC, tokenOut: WETH, amountIn: 10_000_000n, fee: 3000, sqrtPriceLimitX96: 0n }],
})
console.log('QuoterV2: 10 USDC ->', formatUnits(result[0], 18), 'wETH')
