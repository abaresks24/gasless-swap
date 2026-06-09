// Creates the three pools USDC/wETH, wBTC/USDC, wBTC/wETH on our Uniswap V3
// deployment. Circle USDC cannot be minted (budget: our faucet balance), so
// USDC sides are small + concentrated; mintable sides get deep walls.
// Run from frontend/: node scripts/seed-pools-tri.mjs
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { requireEnv } from './env.mjs'

const RPC = 'https://testnet-rpc.monad.xyz'
const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3' // Circle, 6 dec, no mint
const WETH = '0x8AdA6dca334543B2806D467Bd3B58c37aa41F0CA' // TestToken permit, 18 dec
const WBTC = '0x17A9432C233b6d42AFb237c3960dF7A87BEE0044' // TestToken permit, 8 dec
const POSITION_MANAGER = '0xcfb921985158e2f4352f5d5eabdddc4516a01ac8'
const FACTORY = '0x140590c2b34835184a450853dc47fc782673ce70'
const QUOTER = requireEnv('VITE_QUOTER_ADDRESS')
const DEPLOYER_PK = requireEnv('DEPLOYER_PRIVATE_KEY')

const npmAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json', import.meta.url))).abi
const quoterAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json', import.meta.url))).abi
const erc20 = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)'])
const poolAbi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'])

const account = privateKeyToAccount(DEPLOYER_PK)
const transport = http(RPC, { retryCount: 6, retryDelay: 1500 })
const pub = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 1500 })
const wallet = createWalletClient({ account, chain: monadTestnet, transport })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function withRetry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= tries - 1 || !String(e.message).includes('15/sec')) throw e
      await sleep(1500)
    }
  }
}
const read = (params) => withRetry(() => pub.readContract(params))

let nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' })
async function tx(params) {
  const hash = await withRetry(() => wallet.writeContract({ ...params, nonce }))
  nonce++
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`tx reverted: ${params.functionName}`)
  await sleep(400)
  return receipt
}

const sqrtX96 = (price) => BigInt(Math.floor(Math.sqrt(price) * 2 ** 96))
const floor60 = (t) => Math.floor(t / 60) * 60

const SKIP = (process.env.SKIP_POOLS ?? '').split(',').filter(Boolean)

// Mint demo reserves of the mintable tokens, approve once.
if (!SKIP.includes('setup')) {
  await tx({ address: WETH, abi: erc20, functionName: 'mint', args: [account.address, 600n * 10n ** 18n] })
  await tx({ address: WBTC, abi: erc20, functionName: 'mint', args: [account.address, 8n * 10n ** 8n] })
  for (const t of [USDC, WETH, WBTC]) {
    await tx({ address: t, abi: erc20, functionName: 'approve', args: [POSITION_MANAGER, 2n ** 200n] })
  }
  console.log('reserves minted + approvals done')
}

async function setupPool({ label, tokenA, tokenB, priceAB, positions }) {
  // tokenA/tokenB given in any order; price = raw(tokenB) per raw(tokenA)
  const [token0, token1, price] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB, priceAB] : [tokenB, tokenA, 1 / priceAB]
  await tx({
    address: POSITION_MANAGER, abi: npmAbi,
    functionName: 'createAndInitializePoolIfNecessary',
    args: [token0, token1, 3000, sqrtX96(price)],
  })
  const pool = await read({ address: FACTORY, abi: factoryAbi, functionName: 'getPool', args: [token0, token1, 3000] })
  const [, tick] = await read({ address: pool, abi: poolAbi, functionName: 'slot0' })
  const base = floor60(tick)
  for (const p of positions) {
    const [lo, hi] = p.range(base)
    await tx({
      address: POSITION_MANAGER, abi: npmAbi,
      functionName: 'mint',
      args: [{
        token0, token1, fee: 3000,
        tickLower: lo, tickUpper: hi,
        amount0Desired: p.amount0(token0), amount1Desired: p.amount1(token1),
        amount0Min: 0n, amount1Min: 0n,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      }],
    })
  }
  console.log(`${label}: pool ${pool} tick ${tick} — ${positions.length} positions`)
}

const is = (t, x) => t.toLowerCase() === x.toLowerCase()
const USDC_BUDGET = 25n * 10n ** 6n // 25 USDC per USDC pool (Circle USDC is scarce)

// 1) USDC/wETH — 1 USDC = 0.0004 wETH
if (!SKIP.includes('1')) await setupPool({
  label: 'USDC/wETH',
  tokenA: USDC, tokenB: WETH, priceAB: 4e8,
  positions: [
    { // deep wall paying out wETH on USDC -> wETH (token1 side below price when token0 = USDC)
      range: (b) => [b - 18000, b],
      amount0: (t0) => (is(t0, USDC) ? 0n : 250n * 10n ** 18n),
      amount1: (t1) => (is(t1, USDC) ? 0n : 250n * 10n ** 18n),
    },
    { // concentrated straddle so the reverse direction works too
      range: (b) => [b - 3000, b + 3060],
      amount0: (t0) => (is(t0, USDC) ? USDC_BUDGET : 10n * 10n ** 18n),
      amount1: (t1) => (is(t1, USDC) ? USDC_BUDGET : 10n * 10n ** 18n),
    },
  ],
})

// 2) wBTC/USDC — 1 wBTC = 100000 USDC -> raw price USDC-per-wBTC = 1000
if (!SKIP.includes('2')) await setupPool({
  label: 'wBTC/USDC',
  tokenA: WBTC, tokenB: USDC, priceAB: 1000,
  positions: [
    { // deep wall paying out wBTC on USDC -> wBTC (token0 side above price when token0 = wBTC)
      range: (b) => [b + 60, b + 18060],
      amount0: (t0) => (is(t0, WBTC) ? 2n * 10n ** 8n : 0n),
      amount1: (t1) => (is(t1, WBTC) ? 2n * 10n ** 8n : 0n),
    },
    {
      range: (b) => [b - 3000, b + 3060],
      amount0: (t0) => (is(t0, USDC) ? USDC_BUDGET : 10n ** 8n / 2n),
      amount1: (t1) => (is(t1, USDC) ? USDC_BUDGET : 10n ** 8n / 2n),
    },
  ],
})

// 3) wBTC/wETH — 1 wBTC = 40 wETH -> raw price wETH-per-wBTC = 40e18/1e8 = 4e11
if (!SKIP.includes('3')) await setupPool({
  label: 'wBTC/wETH',
  tokenA: WBTC, tokenB: WETH, priceAB: 4e11,
  positions: [
    { // both sides mintable: deep full-ish range
      range: () => [-887220, 887220],
      amount0: (t0) => (is(t0, WBTC) ? 5n * 10n ** 8n : 200n * 10n ** 18n),
      amount1: (t1) => (is(t1, WBTC) ? 5n * 10n ** 8n : 200n * 10n ** 18n),
    },
  ],
})

// Sanity quotes through QuoterV2
for (const [tin, tout, amt, label] of [
  [USDC, WETH, 10n * 10n ** 6n, '10 USDC -> wETH'],
  [WETH, USDC, 10n ** 16n, '0.01 wETH -> USDC'],
  [USDC, WBTC, 10n * 10n ** 6n, '10 USDC -> wBTC'],
  [WETH, WBTC, 10n ** 17n, '0.1 wETH -> wBTC'],
  [WBTC, WETH, 10n ** 6n, '0.01 wBTC -> wETH'],
]) {
  const { result } = await pub.simulateContract({
    address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: tin, tokenOut: tout, amountIn: amt, fee: 3000, sqrtPriceLimitX96: 0n }],
  })
  console.log(`${label}: ${result[0]}`)
}
