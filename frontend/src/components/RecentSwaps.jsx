import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { usePublicClient, useWatchContractEvent } from 'wagmi'
import { DEPLOY_BLOCK, EXPLORER_URL, GASLESSSWAP_ADDRESS, gaslessSwapAbi } from '../constants'

function SwapRow({ swap }) {
  return (
    <a
      href={`${EXPLORER_URL}/tx/${swap.txHash}`}
      target="_blank"
      rel="noreferrer"
      className="animate-slide-in flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-xs transition hover:border-purple/40"
    >
      <span className="font-mono text-sub">
        {swap.user.slice(0, 6)}…{swap.user.slice(-4)}
      </span>
      <span>
        {Number(formatUnits(swap.amountIn, 6)).toLocaleString()} USDC →{' '}
        {Number(formatUnits(swap.amountOut, 18)).toFixed(5)} wETH
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
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-sub">
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
