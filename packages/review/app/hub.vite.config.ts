import path from "node:path";

import { defineConfig } from "vite";

import desktopConfig from "./desktop.vite.config";

/**
 * The standalone canvas the Review Hub serves at `/hub/*`: the Desktop build
 * with the hub entry, absolute asset URLs, and the libavoid wasm emitted as an
 * asset (the Desktop ships its own copy).
 */
export default defineConfig({
  ...desktopConfig,
  base: "/hub/",
  build: {
    ...desktopConfig.build,
    outDir: "dist/hub",
    rollupOptions: {
      ...desktopConfig.build?.rollupOptions,
      input: {
        hub: path.resolve(__dirname, "src/hub-entry.tsx"),
      },
    },
  },
});
