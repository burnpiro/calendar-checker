import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension",
  fullyParallel: false,
  workers: 1,
  use: { trace: "retain-on-failure" },
});
