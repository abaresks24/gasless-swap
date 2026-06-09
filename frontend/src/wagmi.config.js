import { createConfig, http } from 'wagmi'
import { monadTestnet } from 'wagmi/chains'
import { RPC_URL } from './constants'

// No explicit connector: wagmi discovers every installed wallet via EIP-6963
// (Rabby, MetaMask, Phantom, ...) so the user picks instead of being forced
// onto whichever extension injected window.ethereum first.
export const config = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(RPC_URL),
  },
})
