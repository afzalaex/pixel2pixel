import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/contract-config.json": "http://localhost:8080",
      "/round-state": "http://localhost:8080",
      "/terminal-snapshot": "http://localhost:8080",
      "/auction-state": "http://localhost:8080",
      "/final-artwork-svg": "http://localhost:8080",
      "/final-artwork-preview.svg": "http://localhost:8080",
      "/healthz": "http://localhost:8080"
    }
  }
});
