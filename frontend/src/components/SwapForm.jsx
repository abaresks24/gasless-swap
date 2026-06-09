import { useEffect, useState } from 'react'
import { formatUnits, parseUnits, decodeEventLog } from 'viem'
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useReadContract,
  useSwitchChain,
} from 'wagmi'
import {
  CHAIN_ID,
  USDC_ADDRESS,
  WETH_ADDRESS,
  RELAYER_FEE_BPS,
  SLIPPAGE_BPS,
  erc20Abi,
  gaslessSwapAbi,
} from '../constants'
import { signPermit, signIntent } from '../lib/signing'
import { relay, relayerAddress } from '../lib/relayer'
import { quoteExactInput } from '../lib/quoter'
import StatusDisplay from './StatusDisplay'

export default function SwapForm() {
  const { address, isConnected, chainId } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const [amount, setAmount] = useState('100')
  const [quote, setQuote] = useState(0n)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address },
  })

  const amountIn = (() => {
    try {
      return parseUnits(amount || '0', 6)
    } catch {
      return 0n
    }
  })()

  // the LP fee is taken on the input token, so quote the net amount actually swapped
  const netAmountIn = amountIn - (amountIn * RELAYER_FEE_BPS) / 10000n

  useEffect(() => {
    let cancelled = false
    if (!publicClient || netAmountIn === 0n) {
      setQuote(0n)
      return
    }
    const t = setTimeout(async () => {
      try {
        const q = await quoteExactInput(publicClient, netAmountIn)
        if (!cancelled) setQuote(q)
      } catch {
        if (!cancelled) setQuote(0n)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [publicClient, netAmountIn])

  const busy = ['signing_permit', 'signing_intent', 'relaying'].includes(status)
  const insufficient = usdcBalance !== undefined && amountIn > usdcBalance

  async function handleSwap() {
    setError(null)
    setResult(null)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      setStatus('signing_permit')
      const permitSig = await signPermit({
        walletClient,
        publicClient,
        owner: address,
        value: amountIn,
        deadline,
      })

      setStatus('signing_intent')
      const minAmountOut = (quote * (10000n - SLIPPAGE_BPS)) / 10000n
      const { intent, signature: intentSig } = await signIntent({
        walletClient,
        publicClient,
        intent: {
          user: address,
          tokenIn: USDC_ADDRESS,
          tokenOut: WETH_ADDRESS,
          amountIn,
          minAmountOut,
          relayerFeeBps: RELAYER_FEE_BPS,
          deadline,
        },
      })

      setStatus('relaying')
      const receipt = await relay({ intent, permitDeadline: deadline, permitSig, intentSig })

      let userAmountOut = 0n
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: gaslessSwapAbi, data: log.data, topics: log.topics })
          if (ev.eventName === 'IntentExecuted') {
            userAmountOut = ev.args.amountOut // output goes to the user in full
          }
        } catch { /* not our event */ }
      }

      setResult({
        amountOut: Number(formatUnits(userAmountOut, 18)).toFixed(5),
        txHash: receipt.transactionHash,
      })
      setStatus('success')
      refetchUsdc()
    } catch (e) {
      setError(e.shortMessage ?? e.message ?? 'Something went wrong')
      setStatus('error')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
      {/* You pay */}
      <div className="rounded-xl border border-line bg-bg p-3">
        <div className="flex items-center justify-between text-xs text-sub">
          <span>You pay</span>
          {usdcBalance !== undefined && (
            <button
              className="hover:text-fg"
              onClick={() => setAmount(formatUnits(usdcBalance, 6))}
            >
              Balance: {Number(formatUnits(usdcBalance, 6)).toLocaleString()} (max)
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0"
            className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-sub"
          />
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-semibold">
            USDC
          </span>
        </div>
      </div>

      {/* You receive */}
      <div className="rounded-xl border border-line bg-bg p-3">
        <p className="text-xs text-sub">You receive (estimated)</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-2xl font-semibold">
            {quote > 0n ? Number(formatUnits(quote, 18)).toFixed(5) : '—'}
          </span>
          <span className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-semibold">
            wETH
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-sub">
        <span>
          LP fee: {Number(RELAYER_FEE_BPS) / 100}% · Slippage: {Number(SLIPPAGE_BPS) / 100}%
        </span>
        <span className="font-semibold text-green">Gas: 0 MON</span>
      </div>

      <button
        onClick={handleSwap}
        disabled={!isConnected || busy || amountIn === 0n || quote === 0n || insufficient}
        className="rounded-xl bg-purple py-3.5 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!isConnected
          ? 'Connect wallet'
          : insufficient
            ? 'Insufficient USDC'
            : busy
              ? 'Swapping'
              : 'Sign & swap'}
      </button>

      <StatusDisplay status={status} result={result} error={error} />

      <p className="text-center text-[11px] text-sub">
        Executor <span className="font-mono">{relayerAddress.slice(0, 10)}…</span> fronts the gas —
        reimbursed in MON by the LP vault
      </p>
    </section>
  )
}
