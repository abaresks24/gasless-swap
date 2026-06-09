import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { usePublicClient, useWatchContractEvent } from 'wagmi'
import {
  DEPLOY_BLOCK,
  EXPLORER_URL,
  GASLESSSWAP_ADDRESS,
  gaslessSwapAbi,
  tokenByAddress,
} from '../constants'

function fmt(amount, token) {
  if (!token) return '?'
  return `${Number(formatUnits(amount, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 5 })} ${token.symbol}`
}

function SwapRow({ swap }) {
  return (
    <a
      href={`${EXPLORER_URL}/tx/${swap.txHash}`}
      target="_blank"
      rel="noreferrer"
      className="animate-slide-in flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-xs transition hover:border-fg/30"
    >
      <span className="font-mono text-sub">
        {swap.user.slice(0, 6)}…{swap.user.slice(-4)}
      </span>
      <span>
        {fmt(swap.amountIn, swap.tokenIn)} → {fmt(swap.amountOut, swap.tokenOut)}
      </span>
      <span className="text-sub">settled</span>
    </a>
  )
}

export default function RecentSwaps() {
  const publicClient = usePublicClient()
  const [swaps, setSwaps] = useState([])

  const addSwaps = (logs) =>
    setSwaps((prev) => {
      const merged = [...prev]
      for (const log of logs) {
        if (merged.some((s) => s.id === `${log.transactionHash}-${log.logIndex}`)) continue
        merged.unshift({
          id: `${log.transactionHash}-${log.logIndex}`,
          txHash: log.transactionHash,
          user: log.args.user,
          tokenIn: tokenByAddress(log.args.tokenIn),
          tokenOut: tokenByAddress(log.args.tokenOut),
          amountIn: log.args.amountIn,
          amountOut: log.args.amountOut,
        })
      }
      return merged.slice(0, 10)
    })

  useEffect(() => {
    if (!publicClient) return
    publicClient
      .getContractEvents({
        address: GASLESSSWAP_ADDRESS,
        abi: gaslessSwapAbi,
        eventName: 'IntentExecuted',
        fromBlock: DEPLOY_BLOCK,
      })
      .then((logs) => addSwaps(logs.reverse()))
      .catch(() => {})
  }, [publicClient])

  useWatchContractEvent({
    address: GASLESSSWAP_ADDRESS,
    abi: gaslessSwapAbi,
    eventName: 'IntentExecuted',
    onLogs: addSwaps,
  })

  if (swaps.length === 0) return null

  return (
    <section>
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-sub">
        Recent swaps
      </h2>
      <div className="mt-2 flex flex-col gap-1.5">
        {swaps.map((s) => (
          <SwapRow key={s.id} swap={s} />
        ))}
      </div>
    </section>
  )
}
