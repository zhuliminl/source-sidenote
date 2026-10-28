import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const service = process.env.SIDENOTE_URL ?? "http://127.0.0.1:47831";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    // Served from localhost, never over a network; one bundle keeps it simple.
    chunkSizeWarningLimit: 900,
  },
  server: {
    // Dev: open http://localhost:5173/#<token> (token from `sidenote ui`).
    proxy: {
      "/api": {
        target: service,
        changeOrigin: true,
        configure: (proxy) =>
          // The service only accepts its own Origin; the dev server is same-machine.
          proxy.on("proxyReq", (req) => req.removeHeader("origin")),
      },
    },
  },
});
