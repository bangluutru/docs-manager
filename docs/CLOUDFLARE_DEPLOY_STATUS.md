# Cloudflare deployment status — 2026-09-30

Project/Worker: `docs-manager`.
Account: `1b9498a0ce4a2d692b5639adbc2fbb37`.
Live URL: https://docs-manager.bangluutru.workers.dev

## Provisioned and deployed

- D1 `docs-manager`: `77a16ad0-3e61-481a-92da-895e1af6440c`, APAC.
- Migrations 0001–0005 applied remotely; organization `docs-manager-organization`, settings and six numbering patterns initialized.
- Active users: `bangluutru@gmail.com` (ADMIN), `haibangtran@gmail.com` (MEMBER). Access subjects bind on the first verified login. No setup token is required.
- Private R2 buckets `docs-manager-documents` and `docs-manager-assets`.
- Worker bindings DB, DOCUMENT_ARTIFACTS, BRAND_ASSETS, BROWSER and ASSETS; logs and cron every five minutes.
- Access application `docs-manager`: `5f99af1e-1208-4e3f-bb9d-74f6b449b7f5`, protecting the complete live hostname.
- Allow policy `docs-manager-users`: `86d9462c-cae3-4585-b209-333545e7f97c`, includes exactly the two email addresses above; session duration 24 hours. No Everyone or Bypass rule.
- ACCESS_AUD configured; workers.dev enabled; preview URLs disabled.
- Current deployed version: `53341c28-378a-4f5c-a5b6-bb1c6b7c8e3b`.
- Production Vite build and Wrangler deployment succeeded.

## Verification and remaining acceptance

The saved Access policy was read back in the dashboard. Opening the live URL in a browser redirected to Cloudflare Access and displayed “Log in to docs-manager”. Authenticated application login and cloud PDF generation remain unverified: the browser connection became unavailable during the Cloudflare SSO flow. Users can sign in with an allowed email using the Access email login code.

Local checks previously passed: 10 unit, 29 Worker and 5 UI tests, typecheck, build and diff checks. Broader release acceptance gaps (PDF layouts/fonts, role matrix, backup/restore, alerts and cloud fault/load testing) remain in AUDIT_FIXES.md.

Local configuration remains unchanged. Repeat production build before a deploy:

```sh
CLOUDFLARE_ENV=production pnpm build
pnpm exec wrangler deploy
```

No other existing database was modified or deleted by this deployment. The owner freed one D1 slot before this database was created.

## 2026-10-01 release — deployed

- PR #3 merged to `main` (merge commit `f13517c`).
- Migration `0006_company_profile.sql` applied to remote D1. Time Travel bookmark taken just before it: `000000df-00000000-000050f6-d14ca0c1f88bf138420d0047219e506d`.
- Worker deployed as version `3a21b6f2-3e39-47f4-b61c-f602c059078d`, then redeployed from the same code as the current version `248456cc-bacf-4835-9938-1c94b16d8b9f`; bindings DB, DOCUMENT_ARTIFACTS, BRAND_ASSETS, BROWSER, ASSETS and the five-minute cron unchanged.
- Unauthenticated requests to `/`, `/api/v1/health` and `/api/v1/organization` still redirect to Cloudflare Access login.

Still to check after signing in: fill 設定 (company, bank, seal), issue one test document and review the PDF from the managed browser.
