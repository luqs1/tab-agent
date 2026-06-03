import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // Inline all JS/CSS into a single index.html on build, so `dist/index.html` is
  // the whole app in one file. Host it on any dumb static server (GitHub Pages,
  // S3, `python -m http.server`) — there is no backend.
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      // just-bash's browser build still imports node:zlib for its (browser-dead)
      // gzip commands. Point it at a stub so the bundle resolves.
      "node:zlib": fileURLToPath(new URL("./src/shims/zlib.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ["pyodide"],
  },
});
