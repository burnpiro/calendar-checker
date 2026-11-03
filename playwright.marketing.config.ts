import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/marketing",
  workers: 1,
  use: { trace: "retain-on-failure" },
  outputDir: "test-results/marketing",
});
