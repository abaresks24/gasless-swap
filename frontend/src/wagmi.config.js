import { createConfig, http } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { RPC_URL } from './constants'

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http(RPC_URL),
  },
})
