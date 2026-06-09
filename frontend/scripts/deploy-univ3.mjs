// Deploys the real Uniswap V3 stack (official npm artifacts) on Monad testnet,
// creates a USDC/wETH 0.3% pool with full-range liquidity.
// Run from frontend/: node scripts/deploy-univ3.mjs
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

const RPC = 'https://testnet-rpc.monad.xyz'
const USDC = '0xa60545A050Ee596e02044553867917a718EE60df' // existing MockUSDC (EIP-2612)
const WETH = '0xF41e0c179910334430F27879269119E87EDc6CA3' // existing MockWETH
import { requireEnv } from './env.mjs'
const DEPLOYER_PK = requireEnv('DEPLOYER_PRIVATE_KEY')
const ZERO = '0x0000000000000000000000000000000000000000'

const art = (p) => JSON.parse(readFileSync(new URL(`../node_modules/${p}`, import.meta.url)))
const factoryArt = art('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const npmArt = art('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json')
const routerArt = art('@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json')
const quoterArt = art('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json')

const account = privateKeyToAccount(DEPLOYER_PK)
const pub = createPublicClient({ chain: monadTestnet, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(RPC) })

async function deploy(name, artifact, args = []) {
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${name} deploy reverted`)
  console.log(`${name}: ${receipt.contractAddress}`)
  return receipt.contractAddress
}

// 1. Core stack
const factory = await deploy('UniswapV3Factory', factoryArt)
const positionManager = await deploy('NonfungiblePositionManager', npmArt, [factory, WETH, ZERO])
const router = await deploy('SwapRouter02', routerArt, [ZERO, factory, positionManager, WETH])
const quoter = await deploy('QuoterV2', quoterArt, [factory, WETH])

// 2. Pool USDC/wETH 0.3%, price 1 USDC = 0.0004 wETH
// token0 = USDC (lower address), price = 4e14 / 1e6 = 4e8 raw -> sqrt = 2e4
const sqrtPriceX96 = 20000n << 96n
const npmAbi = npmArt.abi
let hash = await wallet.writeContract({
  address: positionManager,
  abi: npmAbi,
  functionName: 'createAndInitializePoolIfNecessary',
  args: [USDC, WETH, 3000, sqrtPriceX96],
})
await pub.waitForTransactionReceipt({ hash })
const pool = await pub.readContract({
  address: factory, abi: factoryArt.abi, functionName: 'getPool', args: [USDC, WETH, 3000],
})
console.log('Pool USDC/wETH 0.3%:', pool)

// 3. Mint reserves + approve + full-range liquidity (1M USDC / 400 wETH)
const erc20 = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const usdcAmount = 1_000_000_000_000n // 1M USDC
const wethAmount = 400n * 10n ** 18n  // 400 wETH
for (const [token, amount] of [[USDC, usdcAmount], [WETH, wethAmount]]) {
  hash = await wallet.writeContract({ address: token, abi: erc20, functionName: 'mint', args: [account.address, amount] })
  await pub.waitForTransactionReceipt({ hash })
  hash = await wallet.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [positionManager, amount] })
  await pub.waitForTransactionReceipt({ hash })
}

hash = await wallet.writeContract({
  address: positionManager,
  abi: npmAbi,
  functionName: 'mint',
  args: [{
    token0: USDC, token1: WETH, fee: 3000,
    tickLower: -887220, tickUpper: 887220,
    amount0Desired: usdcAmount, amount1Desired: wethAmount,
    amount0Min: 0n, amount1Min: 0n,
    recipient: account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
  }],
})
const mintReceipt = await pub.waitForTransactionReceipt({ hash })
console.log('Liquidity minted:', mintReceipt.status)

// 4. Sanity quote: 100 USDC -> ? wETH through the real QuoterV2
const { result } = await pub.simulateContract({
  address: quoter,
  abi: quoterArt.abi,
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: USDC, tokenOut: WETH, amountIn: 100_000_000n, fee: 3000, sqrtPriceLimitX96: 0n }],
})
console.log('Quote 100 USDC ->', formatUnits(result[0], 18), 'wETH')

console.log('\nVITE_ROUTER_ADDRESS=' + router)
console.log('VITE_QUOTER_ADDRESS=' + quoter)
console.log('FACTORY=' + factory, 'NPM=' + positionManager, 'POOL=' + pool)
