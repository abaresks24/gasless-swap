import { createWalletClient, createPublicClient, http, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { GASLESSSWAP_ADDRESS, POOL_FEE, RPC_URL, erc20Abi, gaslessSwapAbi } from '../constants'

// Demo executor: an embedded wallet fronts the gas and is reimbursed +premium
// by the LP vault. In production this is a competitive executor network.
const relayerAccount = privateKeyToAccount(import.meta.env.VITE_RELAYER_PRIVATE_KEY)

const relayerClient = createWalletClient({
  account: relayerAccount,
  chain: monadTestnet,
  transport: http(RPC_URL),
})

export const relayerPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC_URL),
})

export const relayerAddress = relayerAccount.address

/** Gasless faucet for mintable test tokens: the executor pays the mint gas. */
export async function mintTestToken(token, to) {
  if (!token.mintable) throw new Error(`${token.symbol} cannot be minted`)
  const hash = await relayerClient.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'mint',
    args: [to, token.faucetAmount],
    gas: 120_000n,
  })
  return relayerPublicClient.waitForTransactionReceipt({ hash })
}

/** Submit execute() as the executor and wait for inclusion. */
export async function relay({ intent, permitDeadline, permitSig, intentSig }) {
  const { v, r, s } = parseSignature(permitSig)
  const args = [intent, permitDeadline, Number(v), r, s, intentSig, POOL_FEE]
  // Monad charges the gas LIMIT, not gas used — use the node's own estimate
  // with a small margin so the vault reimbursement (+premium) covers it.
  const estimate = await relayerPublicClient.estimateContractGas({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    functionName: 'execute',
    args,
    account: relayerAccount,
  })
  const hash = await relayerClient.writeContract({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    functionName: 'execute',
    args,
    gas: (estimate * 105n) / 100n,
  })
  const receipt = await relayerPublicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Executor transaction reverted')
  return receipt
}
