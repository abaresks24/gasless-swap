import {
  CHAIN_ID,
  GASLESSSWAP_ADDRESS,
  USDC_ADDRESS,
  erc20Abi,
  gaslessSwapAbi,
} from '../constants'

/** EIP-2612 permit signature: lets GaslessSwap pull `value` USDC. No gas. */
export async function signPermit({ walletClient, publicClient, owner, value, deadline }) {
  const nonce = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'nonces',
    args: [owner],
  })
  const signature = await walletClient.signTypedData({
    account: owner,
    domain: {
      name: 'USD Coin', // must match MockUSDC.name() exactly
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: USDC_ADDRESS,
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner,
      spender: GASLESSSWAP_ADDRESS,
      value,
      nonce,
      deadline,
    },
  })
  return signature
}

/** EIP-712 SwapIntent signature. No gas. */
export async function signIntent({ walletClient, publicClient, intent }) {
  const nonce = await publicClient.readContract({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    functionName: 'nonces',
    args: [intent.user],
  })
  const fullIntent = { ...intent, nonce }
  const signature = await walletClient.signTypedData({
    account: intent.user,
    domain: {
      name: 'GaslessSwap',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: GASLESSSWAP_ADDRESS,
    },
    types: {
      SwapIntent: [
        { name: 'user', type: 'address' },
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'minAmountOut', type: 'uint256' },
        { name: 'relayerFeeBps', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SwapIntent',
    message: fullIntent,
  })
  return { intent: fullIntent, signature }
}
