// Copies the standalone canvas build next to the server so a packed hub
// (`scripts/pack-review-hub.mjs`) carries its own viewer at `dist/canvas`.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const source = path.resolve(here, "../../../packages/review/app/dist/hub");

const target = path.resolve(here, "../dist/canvas");

if (!existsSync(path.join(source, ".vite/manifest.json")))
  throw new Error(`Canvas build missing at ${source}; run build:hub first.`);

rmSync(target, { recursive: true, force: true });

cpSync(source, target, { recursive: true });

console.log(`Copied canvas build to ${target}`);
