import { createWalletClient, createPublicClient, http, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { GASLESSSWAP_ADDRESS, POOL_FEE, RPC_URL, gaslessSwapAbi } from '../constants'

// Demo relayer: an embedded wallet funded with a little MON pays the gas.
// In production this is a separate service / competitive relayer network.
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

/** Submit execute() as the relayer and wait for inclusion. */
export async function relay({ intent, permitDeadline, permitSig, intentSig }) {
  const { v, r, s } = parseSignature(permitSig)
  const hash = await relayerClient.writeContract({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    functionName: 'execute',
    args: [intent, permitDeadline, Number(v), r, s, intentSig, POOL_FEE],
    // Monad charges the gas LIMIT, not gas used — and eth_estimateGas pads a
    // lot. A tight explicit limit keeps the executor below the vault's
    // reimbursement (measured gas + overhead + premium), i.e. profitable.
    gas: 600_000n,
  })
  const receipt = await relayerPublicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Relayer transaction reverted')
  return receipt
}
