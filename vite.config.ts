import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { viteSingleFile } from "vite-plugin-singlefile";
import pkg from "./package.json";

// Version shown in the footer; build id (version+sha) detects ANY new deploy,
// not just version bumps.
let sha = "dev";
try {
  sha = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}
const BUILD_ID = `${pkg.version}+${sha}`;

export default defineConfig({
  // Inline all JS/CSS into a single index.html on build, so `dist/index.html` is
  // the whole app in one file. Host it on any dumb static server (GitHub Pages,
  // S3, `python -m http.server`) — there is no backend.
  base: "./", // works at any subpath (e.g. github.io/tab-agent/)
  plugins: [
    viteSingleFile(),
    {
      name: "stamp-version",
      transformIndexHtml: (html) =>
        html.replace(/%TA_BUILD%/g, BUILD_ID).replace(/%TA_VERSION%/g, pkg.version),
    },
  ],
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
