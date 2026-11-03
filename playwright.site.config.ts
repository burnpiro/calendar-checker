import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/site",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure" },
  webServer: {
    command: "python3 -m http.server 4174 --bind 127.0.0.1 --directory site",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
  },
});
