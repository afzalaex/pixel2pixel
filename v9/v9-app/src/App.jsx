import { Navigate, Route, Routes } from "react-router-dom";
import { AppChrome } from "./components/AppChrome";
import { useAppConfig } from "./hooks/useAppConfig";
import { CanvasPage } from "./pages/CanvasPage";
import { AuctionPage } from "./pages/AuctionPage";
import { FinalArtworkPage } from "./pages/FinalArtworkPage";

function AppStatus({ title, detail, onRetry }) {
  return (
    <section className="panel control-grid">
      <h1 className="stack-title">{title}</h1>
      <p className="meta">{detail}</p>
      {onRetry ? (
        <div className="control-row">
          <button type="button" className="app-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const { config, isLoading, error, reload } = useAppConfig();

  if (isLoading) {
    return (
      <AppChrome>
        <AppStatus title="Pixel2Pixel v9" detail="Loading contract configuration..." />
      </AppChrome>
    );
  }

  if (error || !config) {
    return (
      <AppChrome>
        <AppStatus
          title="Config Error"
          detail={error || "Contract config is unavailable"}
          onRetry={() => {
            reload().catch(() => {});
          }}
        />
      </AppChrome>
    );
  }

  return (
    <AppChrome>
      <Routes>
        <Route path="/" element={<CanvasPage config={config} />} />
        <Route path="/auction" element={<AuctionPage config={config} />} />
        <Route path="/final" element={<FinalArtworkPage config={config} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppChrome>
  );
}
