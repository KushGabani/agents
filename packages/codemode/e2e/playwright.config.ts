import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8798;
const e2eDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(e2eDir, "wrangler.jsonc");
const hasCloudflareApiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);

export default defineConfig({
  testDir: e2eDir,
  testMatch: "*.spec.ts",
  timeout: 60_000,
  retries: 2,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`
  },
  webServer: hasCloudflareApiToken
    ? {
        command: `lsof -ti tcp:${PORT} | xargs kill -9 2>/dev/null; npx wrangler dev --config ${configPath} --port ${PORT} --inspector-port 0`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
      }
    : undefined
});
