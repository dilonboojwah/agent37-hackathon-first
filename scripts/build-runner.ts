// Bundles the runner CLI into one file for the Agent37 sandbox: dist/runner.mjs.
import { build } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await build({
  entryPoints: [path.join(root, "src/agent/cli.ts")],
  outfile: path.join(root, "dist/runner.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  alias: { "@": path.join(root, "src") },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
