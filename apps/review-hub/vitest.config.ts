import { defineConfig } from "vitest/config";

import { reviewTestAliases } from "../../packages/review/test-config.js";

export default defineConfig({
  resolve: {
    alias: reviewTestAliases,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
