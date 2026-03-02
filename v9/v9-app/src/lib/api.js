const DEFAULT_API_BASE_URL = "http://localhost:8080";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window !== "undefined") {
    const runningOnBackend = window.location.port === "8080";
    if (runningOnBackend) {
      return trimTrailingSlash(window.location.origin);
    }

    // In local Vite dev, use relative URLs so requests pass through Vite proxy
    // and avoid cross-origin CORS requirements.
    if (window.location.port === "5173") {
      return "";
    }
  }

  return DEFAULT_API_BASE_URL;
}

export function buildApiUrl(pathname) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const base = getApiBaseUrl();
  return base ? `${base}${path}` : path;
}

export function buildWsUrl() {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (fromEnv) {
    const apiBase = new URL(trimTrailingSlash(fromEnv));
    const scheme = apiBase.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${apiBase.host}`;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;

    if (window.location.port === "8080") {
      return `${protocol}//${window.location.host}`;
    }

    if (window.location.port === "5173") {
      return `${protocol}//${host}:8080`;
    }

    return `${protocol}//${window.location.host}`;
  }

  return "ws://localhost:8080";
}

export async function fetchJson(pathname, init = undefined) {
  const response = await fetch(buildApiUrl(pathname), {
    cache: "no-store",
    ...init
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && (payload.error || payload.message)) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}
