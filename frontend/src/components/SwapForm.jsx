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
  GASLESSSWAP_ADDRESS,
  RELAYER_FEE_BPS,
  SLIPPAGE_BPS,
  TOKENS,
  TOKEN_LIST,
  erc20Abi,
  gaslessSwapAbi,
} from '../constants'
import { signPermit, signIntent } from '../lib/signing'
import { relay } from '../lib/relayer'
import { quoteExactInput } from '../lib/quoter'
import StatusDisplay from './StatusDisplay'

function TokenSelect({ value, onChange, exclude }) {
  return (
    <select
      value={value.symbol}
      onChange={(e) => onChange(TOKENS[e.target.value])}
      className="cursor-pointer rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-semibold outline-none"
    >
      {TOKEN_LIST.filter((t) => t.symbol !== exclude?.symbol).map((t) => (
        <option key={t.symbol} value={t.symbol}>
          {t.symbol}
        </option>
      ))}
    </select>
  )
}

export default function SwapForm() {
  const { address, isConnected, chainId } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  const [tokenIn, setTokenIn] = useState(TOKENS.USDC)
  const [tokenOut, setTokenOut] = useState(TOKENS.wETH)
  const [amount, setAmount] = useState(TOKENS.USDC.defaultAmount)
  const [quote, setQuote] = useState(0n)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const { data: balanceIn, refetch: refetchBalance } = useReadContract({
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address },
  })

  const amountIn = (() => {
    try {
      return parseUnits(amount || '0', tokenIn.decimals)
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
        const q = await quoteExactInput(publicClient, tokenIn, tokenOut, netAmountIn)
        if (!cancelled) setQuote(q)
      } catch {
        if (!cancelled) setQuote(0n)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [publicClient, tokenIn, tokenOut, netAmountIn])

  const busy = ['signing_permit', 'signing_intent', 'relaying'].includes(status)
  const insufficient = balanceIn !== undefined && amountIn > balanceIn

  const setIn = (t) => {
    setTokenIn(t)
    setAmount(t.defaultAmount)
    if (t.symbol === tokenOut.symbol) setTokenOut(TOKEN_LIST.find((x) => x.symbol !== t.symbol))
  }
  const flip = () => {
    const inT = tokenIn
    setTokenIn(tokenOut)
    setTokenOut(inT)
    setAmount(tokenOut.defaultAmount)
  }

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
        token: tokenIn,
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
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
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
        if (log.address.toLowerCase() !== GASLESSSWAP_ADDRESS.toLowerCase()) continue
        try {
          const ev = decodeEventLog({ abi: gaslessSwapAbi, data: log.data, topics: log.topics })
          if (ev.eventName === 'IntentExecuted') userAmountOut = ev.args.amountOut
        } catch { /* not our event */ }
      }

      setResult({
        amountOut: Number(formatUnits(userAmountOut, tokenOut.decimals)).toFixed(5),
        symbol: tokenOut.symbol,
        txHash: receipt.transactionHash,
      })
      setStatus('success')
      refetchBalance()
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
          {balanceIn !== undefined && (
            <button
              className="hover:text-fg"
              onClick={() => setAmount(formatUnits(balanceIn, tokenIn.decimals))}
            >
              Balance: {Number(formatUnits(balanceIn, tokenIn.decimals)).toLocaleString()} (max)
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
          <TokenSelect value={tokenIn} onChange={setIn} exclude={tokenOut} />
        </div>
      </div>

      <button
        onClick={flip}
        className="mx-auto -my-1 h-7 w-7 rounded-md border border-line bg-bg text-xs text-sub transition hover:text-fg"
        title="Reverse"
      >
        ↕
      </button>

      {/* You receive */}
      <div className="rounded-xl border border-line bg-bg p-3">
        <p className="text-xs text-sub">You receive (estimated)</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-2xl font-semibold">
            {quote > 0n ? Number(formatUnits(quote, tokenOut.decimals)).toFixed(5) : '—'}
          </span>
          <TokenSelect
            value={tokenOut}
            onChange={(t) => setTokenOut(t)}
            exclude={tokenIn}
          />
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
        disabled={!isConnected || busy || amountIn === 0n || insufficient || quote === 0n}
        className="rounded-xl bg-purple py-3.5 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!isConnected
          ? 'Connect wallet'
          : insufficient
            ? `Insufficient ${tokenIn.symbol} balance`
            : busy
              ? 'Swapping'
              : 'Sign & swap'}
      </button>

      <StatusDisplay status={status} result={result} error={error} />

      <p className="text-center text-[11px] text-sub">
        An executor fronts the gas and is reimbursed in MON by the LP vault
      </p>
    </section>
  )
}
