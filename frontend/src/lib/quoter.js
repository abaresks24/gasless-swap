import { POOL_FEE, QUOTER_ADDRESS, USDC_ADDRESS, WETH_ADDRESS, quoterAbi } from '../constants'

/** Quote USDC -> wETH output through Uniswap V3 QuoterV2 (real pool math). */
export async function quoteExactInput(publicClient, amountIn) {
  if (!amountIn || amountIn === 0n) return 0n
  const [amountOut] = await publicClient.readContract({
    address: QUOTER_ADDRESS,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn: USDC_ADDRESS,
      tokenOut: WETH_ADDRESS,
      amountIn,
      fee: POOL_FEE,
      sqrtPriceLimitX96: 0n,
    }],
  })
  return amountOut
}
