declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    DOCUMENT_ARTIFACTS: R2Bucket;
    BRAND_ASSETS: R2Bucket;
    BROWSER: Fetcher;
    ASSETS: Fetcher;
    APP_ENV: string;
    ORGANIZATION_ID: string;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    SETUP_TOKEN?: string;
  }

  interface GlobalProps {
    mainModule: typeof import("./server/index");
  }
}
