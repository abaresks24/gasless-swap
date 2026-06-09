import { POOL_FEE, QUOTER_ADDRESS, quoterAbi } from '../constants'

/** Quote tokenIn -> tokenOut through Uniswap V3 QuoterV2 (real pool math). */
export async function quoteExactInput(publicClient, tokenIn, tokenOut, amountIn) {
  if (!amountIn || amountIn === 0n) return 0n
  const [amountOut] = await publicClient.readContract({
    address: QUOTER_ADDRESS,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
      fee: POOL_FEE,
      sqrtPriceLimitX96: 0n,
    }],
  })
  return amountOut
}
