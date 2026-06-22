import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 1.27.9 — bind dev server to loopback by default. Set
// VITE_HOST=0.0.0.0 (or a specific LAN IP) to opt back in to LAN access.
// Matches the same opt-in pattern as the backend's BACKEND_HOST.
const HOST = process.env.VITE_HOST ?? "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: {
    host: HOST,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
});
