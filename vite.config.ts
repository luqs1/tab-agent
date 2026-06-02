import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // just-bash's browser build still imports node:zlib for its (browser-dead)
      // gzip commands. Point it at a stub so the bundle resolves.
      "node:zlib": fileURLToPath(new URL("./src/shims/zlib.ts", import.meta.url)),
    },
  },
  server: {
    // OPFS sync access handles + cross-origin isolation niceties.
    // Harmless locally; required if you later run WASM threads.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // pyodide ships its own wasm; we load it from CDN in index.html for the sketch,
  // so nothing special is needed here yet.
  optimizeDeps: {
    exclude: ["pyodide"],
  },
});
