import { useAccount, useConnect, useDisconnect } from 'wagmi'

export default function Header() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <img src="/ghost.png" alt="" className="h-7 w-7 rounded" />
          <span className="text-base font-semibold tracking-tight">ghost</span>
        </div>
        {isConnected ? (
          <button
            onClick={() => disconnect()}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-mono text-sub transition hover:text-fg"
            title="Disconnect"
          >
            {address.slice(0, 6)}…{address.slice(-4)}
          </button>
        ) : (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="rounded-md bg-fg px-3.5 py-1.5 text-xs font-medium text-bg transition hover:opacity-85"
          >
            Connect
          </button>
        )}
      </div>
    </header>
  )
}
