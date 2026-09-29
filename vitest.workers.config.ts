import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
  })],
  test: {
    include: ["test/**/*.workers.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
