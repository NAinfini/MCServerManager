import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.ELECTRON_RENDERER_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [react()],

  // Keep the renderer dev server predictable for the Electron shell.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("@monaco-editor") || id.includes("monaco-editor")) {
            return "monaco";
          }
          if (id.includes("@radix-ui")) {
            return "radix";
          }
          if (id.includes("@tanstack")) {
            return "tanstack";
          }
          if (id.includes("framer-motion") || id.includes("motion")) {
            return "motion";
          }
          if (
            id.includes("react") ||
            id.includes("scheduler") ||
            id.includes("use-sync-external-store")
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
}));
