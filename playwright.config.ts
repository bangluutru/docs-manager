import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./test/e2e",
  workers:1,
  use:{baseURL:"http://127.0.0.1:8799",headless:true,viewport:{width:1440,height:1000},trace:"retain-on-failure"},
  webServer:{command:"pnpm dev --port 8799",url:"http://127.0.0.1:8799",reuseExistingServer:!process.env.CI,timeout:60000},
});
