# Cloudflare deployment status — 2026-09-30

Project/Worker: `docs-manager`.
Account: `1b9498a0ce4a2d692b5639adbc2fbb37`.
Target URL: `https://docs-manager.bangluutru.workers.dev` (not yet enabled).

Provisioned and deployed:

- D1 `docs-manager`: `77a16ad0-3e61-481a-92da-895e1af6440c`, APAC.
- Migrations 0001–0005 applied remotely; organization `docs-manager-organization`, settings and six numbering patterns initialized.
- One ADMIN user provisioned for the account owner's email; Access subject binds on the first verified login. No setup token is required for this pre-provisioned account.
- Private R2 buckets `docs-manager-documents` and `docs-manager-assets`.
- Worker bindings DB, DOCUMENT_ARTIFACTS, BRAND_ASSETS, BROWSER and ASSETS.
- Production variables, logs and cron every five minutes.
- Initial deployed version: `20b0b748-6255-4dd0-b5e1-095172ad8c8b`.
- Production Vite build and Wrangler dry-run/deploy succeeded.

Pending:

1. Save the prepared Access application/policy for the target hostname, allowing only the account owner. The browser tool requires action-time confirmation when creating a new access permission; confirmation has been requested.
2. Read the new Access AUD, update `env.production.vars.ACCESS_AUD`, enable workers.dev with preview URLs remaining disabled, rebuild production and deploy.
3. Verify redirect to Access for anonymous visitors and authenticated application login/PDF generation.

Current production config deliberately has workers.dev disabled and ACCESS_AUD empty while Access setup is pending. The target URL is not yet a usable application. Do not describe this initial deployment as completed acceptance.

Local configuration remains unchanged. Repeat production build before a deploy:

```sh
CLOUDFLARE_ENV=production pnpm build
pnpm exec wrangler deploy
```

No other existing database was modified or deleted by this deployment. The owner freed one D1 slot before this database was created. Full release acceptance gaps remain in AUDIT_FIXES.md.
