// Builds the extension into dist/. MV3 content scripts must be single-file IIFEs,
// so each script gets its own Vite pass; HTML pages get one more.
import { build } from "vite";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--e2e")) process.env.VITE_E2E = "1"; // open shadow roots for Playwright
const watch = process.argv.includes("--watch");
const root = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(root, "dist");

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, "manifest.json"), resolve(out, "manifest.json"));

const shared = { configFile: false, envDir: root, logLevel: "warn" };
const buildOpts = {
  outDir: out,
  emptyOutDir: false,
  minify: false,
  watch: watch ? {} : null,
};

const scripts = [
  { file: "background", entry: "src/background/index.ts", format: "es" },
  { file: "content", entry: "src/content/index.ts", format: "iife" },
  { file: "phishing", entry: "src/content/phishing.ts", format: "iife" },
];

for (const s of scripts) {
  await build({
    ...shared,
    root,
    build: {
      ...buildOpts,
      lib: {
        entry: resolve(root, s.entry),
        name: `ss_${s.file}`,
        formats: [s.format],
        fileName: () => `${s.file}.js`,
      },
    },
  });
}

// HTML pages: popup + offscreen document. Output: dist/ui/popup/popup.html, dist/background/offscreen.html
await build({
  ...shared,
  root: resolve(root, "src"),
  base: "./",
  build: {
    ...buildOpts,
    rollupOptions: {
      input: {
        popup: resolve(root, "src/ui/popup/popup.html"),
        offscreen: resolve(root, "src/background/offscreen.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

console.log(watch ? "Watching for changes..." : "Built dist/");
