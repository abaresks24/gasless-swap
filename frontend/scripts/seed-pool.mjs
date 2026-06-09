// Continues deploy-univ3.mjs after the nonce race: mints reserves, adds
// full-range liquidity to the USDC/wETH 0.3% pool, sanity-quotes via QuoterV2.
// Explicit nonce management to avoid Monad RPC "higher priority" collisions.
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

const RPC = 'https://testnet-rpc.monad.xyz'
const USDC = '0xa60545A050Ee596e02044553867917a718EE60df'
const WETH = '0xF41e0c179910334430F27879269119E87EDc6CA3'
const POSITION_MANAGER = '0xcfb921985158e2f4352f5d5eabdddc4516a01ac8'
const QUOTER = '0xcca9846ac0269606cd0f33b7ffa397d9064acdd6'
const POOL = '0x767E3cb46c16658dEfAEdEEC3542cF4C6528B156'
import { requireEnv } from './env.mjs'
const DEPLOYER_PK = requireEnv('DEPLOYER_PRIVATE_KEY')

const npmAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json', import.meta.url))).abi
const quoterAbi = JSON.parse(readFileSync(new URL('../node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json', import.meta.url))).abi

const erc20 = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
])

const account = privateKeyToAccount(DEPLOYER_PK)
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 })
const pub = createPublicClient({ chain: monadTestnet, transport, pollingInterval: 1500 })
const wallet = createWalletClient({ account, chain: monadTestnet, transport })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function withRetry(fn, tries = 6) {
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
  await sleep(500)
  return receipt
}

const usdcAmount = 1_000_000_000_000n // 1M USDC
const wethAmount = 400n * 10n ** 18n  // 400 wETH

for (const [token, amount, label] of [[USDC, usdcAmount, 'USDC'], [WETH, wethAmount, 'wETH']]) {
  const bal = await read({ address: token, abi: erc20, functionName: 'balanceOf', args: [account.address] })
  if (bal < amount) {
    await tx({ address: token, abi: erc20, functionName: 'mint', args: [account.address, amount] })
    console.log(`minted ${label}`)
  }
  const allowance = await read({ address: token, abi: erc20, functionName: 'allowance', args: [account.address, POSITION_MANAGER] })
  if (allowance < amount) {
    await tx({ address: token, abi: erc20, functionName: 'approve', args: [POSITION_MANAGER, amount] })
    console.log(`approved ${label}`)
  }
}

await tx({
  address: POSITION_MANAGER,
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
console.log('liquidity minted ✅')

const poolUsdc = await read({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [POOL] })
const poolWeth = await read({ address: WETH, abi: erc20, functionName: 'balanceOf', args: [POOL] })
console.log(`pool reserves: ${formatUnits(poolUsdc, 6)} USDC / ${formatUnits(poolWeth, 18)} wETH`)

const { result } = await withRetry(() => pub.simulateContract({
  address: QUOTER,
  abi: quoterAbi,
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: USDC, tokenOut: WETH, amountIn: 100_000_000n, fee: 3000, sqrtPriceLimitX96: 0n }],
}))
console.log('QuoterV2: 100 USDC ->', formatUnits(result[0], 18), 'wETH')
