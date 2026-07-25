import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// The renderer used to print "v0.1.0" as a literal in two places, so every
// release would have shipped a version label that disagreed with the binary.
// electron-builder takes the packaged version from this same field, so reading
// it here keeps the label and the artifact in step by construction.
const appVersion = createRequire(import.meta.url)("./package.json")
  .version as string;

// The renderer displays marketplace descriptions from Modrinth, BBSMC, and
// Hangar. MarketplaceMarkdown sanitizes that HTML, but a sanitizer is one
// mistake away from being the only defence, so the packaged renderer also runs
// under a policy that cannot execute injected script at all.
//
// Build only: Vite's dev server needs an inline HMR script and a websocket.
// Everything the app actually loads is local; the remote allowances are images
// (player heads and marketplace thumbnails) and nothing else. All network calls
// go through the Electron backend, never from the renderer.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  // Monaco, xterm, and motion all write inline styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // No frame-ancestors: it is ignored in a <meta> policy, and the renderer is a
  // standalone Electron window that denies every window-open request anyway.
].join("; ");

function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: "mcsm-content-security-policy",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: contentSecurityPolicy,
          },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.ELECTRON_RENDERER_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [react(), contentSecurityPolicyPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },

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
    // The backend tests do real filesystem work - provisioning, extraction,
    // hashing, SQLite - and on a two-core Windows runner with Defender scanning
    // every write, parallel workers starve each other badly enough that a test
    // measured at 460ms locally can exceed 15s. That budget lived as a magic
    // number duplicated across two workflow files and still failed a release
    // build intermittently. One number, here, so a local run and CI agree.
    // Lower it to catch genuinely slow tests; it is not hiding one today.
    testTimeout: 60_000,
    include: [
      "src/**/*.test.{ts,tsx,mjs}",
      "electron/**/*.test.mjs",
      "e2e/support/**/*.test.ts",
      "*.test.mjs",
    ],
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
