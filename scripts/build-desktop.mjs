import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "electron"), { recursive: true });
mkdirSync(join(root, "dist/renderer"), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/production/electron-host/launch.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(root, "electron/main.mjs"),
  external: ["electron"],
  packages: "external",
  logLevel: "info",
});

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/production/operator-console/renderer/main.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: join(root, "dist/renderer/console.js"),
  logLevel: "info",
});

cpSync(join(root, "src/production/electron-host/preload.cjs"), join(root, "electron/preload.cjs"));
cpSync(join(root, "src/production/operator-console/renderer/index.html"), join(root, "dist/renderer/index.html"));
cpSync(join(root, "node_modules/cesium/Build/Cesium"), join(root, "dist/renderer/cesium"), { recursive: true });
cpSync(join(root, "public/city-tiles"), join(root, "dist/renderer/city-tiles"), { recursive: true });
console.log("desktop build ready");
