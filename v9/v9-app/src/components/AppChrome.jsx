import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NavLink } from "react-router-dom";
import { shortAddress } from "../lib/format";

function navClassName({ isActive }) {
  return isActive ? "route-link route-link-active" : "route-link";
}

export function AppChrome({ children }) {
  return (
    <>
      <header className="navbar">
        <div className="nav-shell">
          <NavLink to="/" className="brand" end>
            <img src="/aex-logo.svg" className="logo" alt="aex logo" />
          </NavLink>

          <nav className="route-nav" aria-label="Primary">
            <NavLink className={navClassName} to="/" end>
              Canvas
            </NavLink>
            <NavLink className={navClassName} to="/auction">
              Auction
            </NavLink>
            <NavLink className={navClassName} to="/final">
              Final
            </NavLink>
          </nav>

          <div className="wallet-shell">
            <ConnectButton.Custom>
              {({
                account,
                chain,
                mounted,
                openAccountModal,
                openChainModal,
                openConnectModal
              }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                if (!connected) {
                  return (
                    <button type="button" className="wallet-btn" onClick={openConnectModal}>
                      Connect Wallet
                    </button>
                  );
                }

                if (chain.unsupported) {
                  return (
                    <button type="button" className="wallet-btn" onClick={openChainModal}>
                      Wrong Network
                    </button>
                  );
                }

                return (
                  <button type="button" className="wallet-btn" onClick={openAccountModal}>
                    {shortAddress(account.address)}
                  </button>
                );
              }}
            </ConnectButton.Custom>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
