import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet
} from "@rainbow-me/rainbowkit/wallets";
import { DEFAULT_RPC } from "../lib/constants";

const rpcUrl = import.meta.env.VITE_SEPOLIA_RPC || DEFAULT_RPC;
const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "11111111111111111111111111111111";

export const wagmiConfig = getDefaultConfig({
  appName: "Pixel2Pixel v9",
  projectId: walletConnectProjectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(rpcUrl)
  },
  wallets: [
    {
      groupName: "Recommended",
      wallets: [
        injectedWallet,
        metaMaskWallet,
        rabbyWallet,
        coinbaseWallet,
        walletConnectWallet
      ]
    }
  ],
  ssr: false
});
