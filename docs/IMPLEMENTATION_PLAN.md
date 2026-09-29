# Japanese Business Document & Sales Management — implementation plan

Date: 2026-09-29 · Planning baseline v1 · Status: **Approved for implementation by user on 2026-09-29**

Authority: `PRODUCT_REQUIREMENTS.txt`, PRD v1.0. This plan specifies how to build that product. User approved implementation against this plan. Approval accepts the proposed baseline decisions except items explicitly gated below; it does not claim statutory compliance. Phase 0 establishes verified runtime constraints before enabled production deployment.

## 1. Repository and environment assessment

- Workspace: `/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager`. Initially empty, including hidden files. No application, package manifest, lockfile, tests, CI, database, or Cloudflare configuration exists.
- At the planning baseline Git resolved to the ancestor `/Users/tranhaibang/.gemini/antigravity-ide`, branch `main`, tracking `origin/main`. That ancestor has many unrelated existing changes. Do not stage, clean, reset, or commit the ancestor wholesale. The implementation initialized a project-scoped `.git` here; its first commit captured the proposed planning baseline, and the later implementation commit records the user's approval and execution status. Keep all Git operations scoped to this project.
- macOS; Node v24.12.0, npm 11.6.2, pnpm available. No global Wrangler found. Install a project-local Wrangler only during approved implementation.
- No applicable AGENTS.md found in the workspace or checked ancestor chain through `/Users`. No existing conventions to inherit.
- Cloudflare account, permissions, domain, Access identity provider, Browser Run entitlement, budget, existing backups, and production data have not been inspected or verified. No credentials were requested or read.
- Consequence: greenfield architecture. Actual cloud compatibility, fonts, latency, and account limits require the phase-0 spike; documentation research is not a runtime test.

## Current implementation status — 2026-09-30

The local V1 application has a working React/Vite interface and Hono Worker backed by local D1, with organization-scoped auth context, six document types, Japanese A4 preview/PDF issuance, snapshot revisions and numbering, master data, invoice payments/corrections, receipts, sales summaries, search filters, and audit history. Invoice transaction date/period and issue idempotency are implemented. Evidence on 2026-09-30: `pnpm typecheck`, nine `pnpm test` domain/rendering cases, and `pnpm build` pass; Wrangler reports no pending local migrations and `d1_migrations` contains 0001–0003; local API smoke confirmed transaction-date persistence, same-key issue retry returning the same number, and PO issue rejected with `PURCHASE_POLICY_PENDING` (409). Browser review confirmed the Japanese A4 draft and D08 explanation render and the issue action is absent. The local demo auth path is restricted to development on localhost. PO/OC drafts and previews are available, while API issuance is held behind unresolved D08 policy.

This is implementation progress, not release acceptance or production readiness. Cloudflare account/runtime and Browser Run rendering, load/cap and recovery fault-injection gates, integration/concurrency coverage, formal D1 integrity checks, actual print review, organization/tax-owner decisions, D08 purchase semantics, D11 cancellation/refund/retention policy, and D12 identity/domain/backup/cost ownership remain unverified. The local D1 CLI rejects `PRAGMA integrity_check` with `SQLITE_AUTH`, so this check still needs a supported verification path. No production migration or deployment has been run. The implementation phases below remain open until their acceptance gates are evidenced.

## 2. Decisions, assumptions, and approval gates

Recommendations below become the implementation baseline only when approved. Explicitly unresolved operational inputs must be resolved at the stated gate; do not silently substitute a different product policy.

| ID | Proposed baseline / missing requirement | Gate |
|---|---|---|
| D01 | One operating organization per deployment; schema and authorization still organization-scoped. No organization-switching UI in V1. | Plan approval |
| D02 | JPY only; business dates use Asia/Tokyo; UTC timestamps. No foreign exchange, refunds, credit notes, withholding, or negative lines in V1. Confirm these exclusions fit actual business. | Plan approval |
| D03 | 売上高 = net-of-tax value of effective issued invoices grouped by invoice date. 請求済 = corresponding gross value. No quotation/delivery/payment recognition. | Plan approval |
| D04 | Members can create, issue, convert, mark sent, and register payments; administrators additionally manage settings/users, correct payments, and revise issued documents. | Plan approval |
| D05 | Corrections retain the base number, use revision suffix display, and replace the effective revision only upon successful issue. Restrict monetary revisions after any payment, and invoice revisions after a receipt, pending approved correction policy. | Plan approval |
| D06 | Issue numbers allocated at issuance, not draft creation. Gaps permitted and recorded. Sequence year uses issue date; reject future issue dates by default, allow historical issue dates. | Plan approval |
| D07 | Full-payment invoice → one full-amount receipt only; partial-payment receipts and standalone receipt evidence need business approval. Direct receipts remain supported with manual payment details. | Plan approval |
| D08 | Outgoing purchase order → incoming supplier confirmation is semantically ambiguous. Recommend V1 creates outgoing 注文請書 as our acceptance of a customer's external order. Preserve optional PO relation but do not issue on a supplier's behalf. | **Resolve before purchase module** |
| D09 | Qualified issuer mode on/off. Registration number mandatory in qualified mode; ordinary invoices allowed without a qualified claim. Confirm company registration status and tax defaults. | Before masters/issuance |
| D10 | Proposed caps: 200 lines, 40 pages, 2 MB decoded logo/seal each; quantity and price up to 4 decimal places; totals ≤ ¥999,999,999,999. Reject over-cap input explicitly. Validate realistic needs in spike. | Phase 0 |
| D11 | Retention period, document cancellation, erroneous paid invoices, returns, and payment refunds are unspecified. Do not invent accounting workflows; resolve handling before production. No hard deletion of issued material. | Before production |
| D12 | Cloudflare account/domain, Access IdP, authorized users, data residency expectations, cost ceiling, backup destination and recovery objectives require an owner. Proposed RPO 24h/RTO 4h, subject to approval and restore drill. | Phase 0 / production |
| D13 | Explicit save for drafts; dirty-state warning. SENT is a manually recorded event, not email sending. No email integration. | Plan approval |

Important tensions: PRD dashboard example has sales greater than invoiced without defining recognition; the proposed net/gross invoice model intentionally gives those labels explicit meanings, not those sample values. Financial fields cannot all stay editable after issue. Payment and delivery events must live separately from immutable document content. Hashes detect changes but are not legal timestamps or proof of statutory compliance. Cancellation/returns are operational gaps, not permission to add a ledger.

## 3. Architecture and technology

Use one TypeScript application: React SPA + API Worker, Workers Static Assets, D1, private R2, and Cloudflare Browser Run (formerly Browser Rendering) for Chromium PDF output. Cloudflare documents this React/Vite/Worker deployment path. [React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [Vite integration](https://developers.cloudflare.com/workers/vite-plugin/).

Recommended implementation choices:

| Concern | Choice and rationale |
|---|---|
| UI | React, TypeScript strict, Vite, React Router; Japanese interface; CSS variables and small accessible components. No SSR/SEO requirement for this internal app. |
| Forms/contracts | Zod schemas shared between client and server; server validates again; React Hook Form for line-item editor. |
| API | Hono routing/middleware in one Worker, JSON REST; explicit services and SQL repositories. |
| Persistence | D1 prepared SQL and reviewed SQL migrations, no generic ORM transaction assumptions. |
| Calculation | Pure TypeScript functions using scaled integers/BigInt rational arithmetic; no binary floating-point money. Serialize decimal inputs as strings. |
| PDF | Shared JDS HTML/CSS and page composition, rendered with `@cloudflare/puppeteer` through Browser Run. |
| Auth | Cloudflare Access + verified application JWT + application membership and role checks. |
| Tests | Vitest, Cloudflare Workers test integration, Playwright; PDF text/geometry inspection and raster comparisons in CI. |
| Tooling | pnpm, project-local Wrangler, ESLint, formatting, pinned dependency lockfile. Confirm mutually compatible stable versions in phase 0; do not install arbitrary future/latest versions without validation. |

Request path: employee browser → Access → Worker (identity, role, organization, validation) → domain service → D1. Authorized file downloads pass through Worker → private R2. Issue service sends self-contained trusted renderer HTML to managed Chromium → PDF bytes → SHA-256 → R2 → final D1 transition. Client never gets storage credentials.

One production Worker, D1 database, artifact bucket, and asset bucket; separate bindings/resources for staging and development. Browser rendering can remain within the API Worker initially. A persistent D1 issue-job table and scheduled recovery handler handle interrupted issuance; no queue/workflow/event bus needed at initial volume. Reassess only after measured constraints.

Cloudflare deployment: configure custom hostname, Access protection, D1 binding `DB`, R2 bindings `DOCUMENT_ARTIFACTS`/`BRAND_ASSETS`, browser binding `BROWSER`, static asset binding, and recovery schedule. Disable public workers.dev and preview exposure in production. Force Worker handling for `/api/*` and protected assets; unmatched API paths return JSON 404, never SPA HTML. Use separate Access audiences per environment. Pin compatibility date after tests. No Supabase, Firebase, Vercel, or Node server.

## 4. Authentication, authorization, and security

Access uses the company's existing identity provider where possible; allowlisted email OTP is a fallback decision, not automatic signup. Worker verifies JWT signature using the configured team JWKS, exact issuer and application audience, expiration and relevant temporal claims. Never trust a bare email header. [Access application tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

Map verified subject to an active local user. Initial administrator is provisioned through a reviewed setup procedure, not “first visitor becomes admin.” Invited email may bind to a verified subject on first login using a one-time conditional update; users cannot choose organization or role in requests. Disabling an app user immediately blocks subsequent app access even with a valid Access session. Do not rely solely on client route guards.

| Operation | MEMBER | ADMIN |
|---|---|---|
| View/search documents and sales in own organization | Yes | Yes |
| Create/edit drafts, duplicate, convert, issue, mark sent | Yes | Yes |
| Maintain counterparties and products; archive master data | Yes | Yes |
| Register a payment on issued invoice | Yes | Yes |
| Correct payments, revise issued documents | No | Yes |
| Organization, bank, numbering, tax, users, branding settings | No | Yes |
| Delete/overwrite issued versions or PDF artifacts | No | No |

Every repository method requires organization context. Use composite foreign keys to enforce that linked data belong to the same organization. File lookup checks organization and document membership before retrieving any R2 key. No endpoint accepts arbitrary object keys, renderer URLs, organization IDs, role assignments, or user HTML. SQL is bound; sort expressions selected from an allowlist.

Same-origin API, Origin checks plus CSRF token for mutations, restrictive CORS, CSP, escaped text, upload signature/dimension checks, raster PNG/JPEG branding only, upload size limits, and private/no-store headers for business data. No sensitive localStorage/offline cache. Revoke browser Blob URLs. Block external network requests during PDF rendering except controlled font/asset delivery, preferably embed assets. Never render user HTML or fetch a URL from a notes field. Rate-limit rendering and mutations per user/organization. Secrets use Cloudflare secret storage; logs redact document content, bank details, tokens and PII. Separate deployment credentials from runtime bindings.

## 5. Module and route structure

Proposed source organization:

- `src/client/`: shell, routes, UI, feature screens for dashboard/documents/payments/sales/masters/settings.
- `src/server/`: Worker entry, auth/context, routes, services, repositories, issue recovery, errors.
- `src/domain/`: tax, money, numbering patterns, lifecycle, conversion, payment state, sales definition, field contracts.
- `src/jds/`: shared document view model, six semantic field configurations, typography, page compositor, print CSS, template versions.
- `migrations/`, `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/rendering/fixtures/`, `docs/`.

Dependencies: UI and server may import domain/JDS; domain imports no React, D1, R2 or Worker bindings. Repository code stays server-only. Server recomputes all monetary totals; never trusts totals posted by the UI.

UI routes:

| Path | Screen |
|---|---|
| `/` | ホーム: current month, four metrics, trend, recent docs, overdue invoices |
| `/documents?type=…` | All six filters under 帳票; searchable list |
| `/documents/new?type=…` | Structured editor + A4 preview |
| `/documents/:id` | Document detail, related documents, versions, payment history, audit events |
| `/documents/:id/revisions/:revision` | Historical immutable revision |
| `/documents/:id/edit` | Current draft only |
| `/sales` | Monthly/counterparty sales and unpaid/overdue details |
| `/counterparties`, `/counterparties/:id` | Unified 取引先, multiple contacts |
| `/products` | 商品・サービス |
| `/settings/:section` | Organization, branding, bank, documents/numbering, users |

API prefix `/api/v1`: GET session; GET/POST masters; PATCH masters/:id; GET/PATCH organization/settings; GET/POST documents; GET/PATCH documents/:id/draft; POST documents/:id/{issue,mark-sent,revise,duplicate,convert}; GET issue-jobs/:id; GET documents/:id/revisions/:n/pdf; GET documents/:id/{relations,audit,payments}; POST documents/:id/payments; POST payments/:id/corrections; GET sales/{summary,monthly,counterparties}; admin user endpoints. No generic issued-document PATCH or delete endpoint. Issuing a correction revision requires ADMIN even though issuing an original draft permits MEMBER; enforce the distinction on the issue endpoint itself.

Responses use `{data, nextCursor}` or `{error:{code,message,fieldErrors,requestId}}`. Conflict 409; invalid data 422; authentication 401; role denial 403; inaccessible object 404. POST issue/payment/convert/revise/duplicate require idempotency key and payload fingerprint. PATCH drafts require version token; stale edits fail rather than overwriting a colleague's work. Conversion returns a saved destination draft, not a URL-only action.

## 6. D1 schema contract

This is a schema specification, not an executed migration. Use UUID TEXT IDs, ISO `YYYY-MM-DD` TEXT business dates, UTC timestamp TEXT, INTEGER booleans, INTEGER yen; decimal inputs TEXT with canonical format. `org_id` below means `organization_id`. Each scoped table has `UNIQUE(org_id,id)` as a composite FK target. Required fields are non-null unless marked `?`. All JSON carries a schema version and is validated before storage; queryable fields stay typed columns.

| Table | Columns and constraints |
|---|---|
| organizations | id PK; legal_name, display_name, postal_code, prefecture, address, building?, phone?, email?, website?, representative?; created_at, updated_at |
| users | id PK, org_id FK, access_subject? UNIQUE, email, display_name, role CHECK ADMIN/MEMBER, active, created_at, updated_at; UNIQUE(org_id,email); role changes audited; cannot disable/demote last admin |
| organization_settings | org_id PK/FK; version INTEGER; registration_number?, qualified_mode, bank_json, payment_terms_json, default_tax_mode, tax_rounding, line_rounding, theme, accent_color, logo_asset_id?, seal_asset_id?, delivery_show_amounts, quotation_title, purchase_order_title, updated_at |
| brand_assets | id PK, org_id, kind LOGO/SEAL, object_key UNIQUE, sha256, mime, bytes, width, height, created_at; immutable replacement by new asset ID |
| counterparties | id PK, org_id, name, kana?, normalized_name, is_customer, is_supplier, postal_code?, prefecture?, address?, building?, phone?, email?, website?, default_terms_json?, notes?, active, version, created_at, updated_at; CHECK at least one role |
| counterparty_contacts | id PK, org_id, counterparty_id composite FK, department?, name, email?, phone?, is_default, active; at most one active default via partial unique index |
| products | id PK, org_id, code, name, description?, unit, unit_price_decimal, tax_class, active, version, created_at, updated_at; UNIQUE(org_id,code) |
| documents | id PK, org_id, type CHECK QT/DN/INV/RC/PO/OC; number?, number_year?, sequence_value?; counterparty_id? composite FK; current_issued_revision_id?; active_draft_revision_id?; created_by, created_at; UNIQUE(org_id,number); indexable identity only, no mutable financial payload |
| document_revisions | id PK, org_id, document_id composite FK, revision INTEGER ≥0, previous_revision_id?; state CHECK DRAFT/ISSUING/ISSUED/ABANDONED; version; counterparty_id?; recipient_snapshot_json, recipient_search_name, issuer_snapshot_json, bank_snapshot_json, render_settings_json; issue_date, transaction_date?, period_start?, period_end?, due_date?, subject, currency CHECK JPY; tax_mode, tax_rounding, line_rounding; subtotal_yen, tax_yen, total_yen; tax_summary_json, conditions_json, notes?, type_fields_json; snapshot_schema_version, renderer_version, tax_engine_version; created_by, created_at, updated_at, issued_at?, sent_at?; UNIQUE(org_id,document_id,revision) |
| document_items | id PK, org_id, revision_id composite FK, position, product_id?, code?, description, quantity_decimal, unit, unit_price_decimal, tax_class, line_amount_yen, transaction_date?; UNIQUE(org_id,revision_id,position); line amounts are stored calculation outputs |
| document_relations | id PK, org_id, source_revision_id FK, target_document_id FK, kind CONVERTED_FROM/DUPLICATED_FROM/ORDER_REFERENCE/RECEIPT_FOR; created_by, created_at; UNIQUE(org_id,source_revision_id,target_document_id,kind); no self-reference/cycles |
| number_sequences | org_id, type, year, last_value, pattern_snapshot; PK(org_id,type,year) |
| numbering_settings | org_id, type, pattern, next_year_policy, updated_at; PK(org_id,type); no change to existing reserved numbers |
| number_reservations | id PK, org_id, document_id UNIQUE per org, type, year, sequence_value, formatted_number, reserved_at; UNIQUE(org_id,formatted_number); UNIQUE(org_id,type,year,sequence_value); never delete/recycle |
| payments | id PK, org_id, invoice_document_id FK, invoice_revision_id FK, payment_date, amount_yen >0, method BANK_TRANSFER/CASH/CARD/OTHER, note?, created_by, created_at, voided_at?, voided_by?, correction_reason?, replaces_payment_id?; original amount/date immutable; updates only append correction metadata |
| document_files | id PK, org_id, revision_id FK, kind ISSUED_PDF, object_key UNIQUE, sha256, bytes, mime, generated_at, renderer_version; UNIQUE(org_id,revision_id,kind) |
| issue_jobs | id PK, org_id, revision_id UNIQUE per org, state PENDING/RENDERING/STORED/COMPLETE/FAILED, snapshot_hash, object_key, attempt_count, lease_token?, lease_expires_at?, next_attempt_at?, last_error_code?, created_at, updated_at; fixed issue timestamp stored in frozen snapshot |
| idempotency_requests | org_id, actor_id, operation, key, request_hash, resource_id?, response_json?, state, created_at; composite PK(org_id,actor_id,operation,key); issue/payment keys retained with business records |
| audit_logs | id PK, org_id, actor_id?, action, entity_type, entity_id, revision_id?, occurred_at, request_id, details_json; append-only, no secrets; old/new field summaries or version identifiers as appropriate |

Additional constraints: indexes for both document revision pointers; pointer must reference same document/org and appropriate state, enforced by triggers plus service checks. One active DRAFT/ISSUING revision per logical document via partial unique index. A partial unique relation index on `(org_id,source_revision_id)` for kind RECEIPT_FOR prevents concurrent full-receipt creation; require source to be the effective invoice revision, and prevent revising that invoice once a receipt claim exists. An abandoned receipt draft retains its claim until an explicit audited release with no issued receipt; ordinary duplication must not copy a RECEIPT_FOR claim. Master data are archived, not deleted if referenced. Historical snapshot data never reconstructed from current masters. Cascading delete allowed only for unissued draft-owned children under an explicit guarded operation; do not expose hard-delete in initial UI.

DB triggers reject changes/deletion to issued revision content and items; separate allowed metadata columns such as sent_at from frozen payload checks. Freeze ISSUING payload too. Prevent audit deletion and number reuse through application/DB protections; account administrators with database access remain an operational trust boundary.

Relationships: organization 1:N users/masters/documents; counterparty 1:N contacts; document 1:N revisions; revision 1:N items and 1:1 issued PDF; documents linked via source revision → target identity; invoice document 1:N payments, each pinned to revision at registration. Issued pointer defines the effective financial revision; previous revisions remain addressable.

## 7. Indexes, transactions, migrations

Indexes (org_id leading on all scoped queries):

- documents `(org_id,type,created_at DESC,id DESC)`, unique `(org_id,number)`; prefix number search; separate normalized number if normalization is used.
- revisions `(org_id,state,issue_date DESC,id DESC)`, `(org_id,state,transaction_date,id)`, `(org_id,counterparty_id,issue_date,id)`, `(org_id,total_yen,id)`, `(org_id,due_date,document_id)` for issued invoices; item `(org_id,revision_id,position)`.
- payments `(org_id,invoice_document_id,voided_at,payment_date)` and `(org_id,payment_date,id)`; relations on both source and target; audit `(org_id,entity_type,entity_id,occurred_at,id)`; jobs `(state,next_attempt_at,lease_expires_at)`; masters normalized name/code.
- Effective invoice query joins documents.current_issued_revision_id. Confirm plans with EXPLAIN QUERY PLAN on realistic fixtures; add a composite index only for measured common filters. No unbounded SELECT * or application-wide fetch-and-filter.

D1 `batch()` executes statements transactionally and rolls back on SQL failure. Do not assume arbitrary interactive BEGIN/COMMIT or an ORM callback works. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Race safety must use conditional writes + constraints/triggers within a batch. A zero-row conditional update is **not** a SQL failure: dependent INSERTs must select only from rows matching the expected version/operation token, or a checked guard row/trigger must abort the entire batch. Verify changes and return 409 if the guard did not match. Never append audit/payment rows unconditionally after a failed guard. IDs generated before batch permit related writes without application-side read-between-statements.

Logical identity type/number and revision ownership are immutable after reservation; enforce with triggers. File metadata and number reservations are append-only. Frozen snapshot fields and items cannot change even on ABANDONED revisions. Payment cap checking occurs inside the same transactional insert using the effective issued total and SUM(nonvoid payments); trigger rejects if another writer exhausted the balance. Revision activation rechecks absence of payments and receipt constraints atomically. Use primary-consistent reads on mutation-sensitive paths; do not introduce read replication until session consistency is addressed.

Numbered forward migrations: 0001 organizations/users/settings; 0002 masters; 0003 documents/revisions/items/relations; 0004 numbering/idempotency/jobs/files; 0005 payments/audit/protection triggers/indexes. Ordering may shift to satisfy FK dependencies; schema is reviewed as a whole. Apply on local fresh DB, seeded older version, then staging copy; foreign_key_check, integrity checks, representative query plans. Rebuild tables explicitly when SQLite requires it. No production auto-migration during requests. Expand/contract for deployed changes. Backup before migration; roll back compatible Worker first, otherwise forward repair or tested restore. Record exact migration/build IDs.

## 8. Snapshot, lifecycle, revision, numbering, conversion

Snapshot payload includes recipient company/contact/address/honorific override; issuer legal details/registration; bank; every item description/price/tax; terms; dates; title/theme/accent; immutable logo/seal IDs and hashes; all calculations, rounding choices, and template/schema/tax versions. Draft selects master data once; explicit “最新の取引先情報を反映” refresh is allowed only before issue. Editing masters never changes documents silently.

Business lifecycle: DRAFT → ISSUED → SENT. ISSUING is an internal locked transition with UI “発行処理中”; it is not proof of issuance. On success, ISSUED becomes financially effective. SENT is a separate timestamp/event and never overwrites paid state. Invoices derive UNPAID/PARTIALLY_PAID/PAID and overdue independently; display both delivery and payment state where needed. Drafts can be edited/duplicated; issued data only revised. No send integration.

Revision rules: original is revision 0, shown without suffix; correction is revision 1+, shown with base number + `改訂1`, including on PDF. Create new draft from selected issued snapshot, record reason and previous revision, retain all history. ABANDONED is an internal terminal state for failed/unissued attempts; it never contributes sales and never frees a PDF key. While correcting, old revision remains effective. On issue success switch current pointer atomically; queries count only that pointer. Original snapshot/PDF stays unchanged. Failed correction leaves original effective. Do not allow parallel correction drafts. Restrict paid invoice revisions as D05; bank/recipient mistakes in paid invoices require approved policy before release rather than ad hoc edits.

Number reservation: defaults QT/DN/INV/RC/PO/OC-{YYYY}-{####}. Grammar supports only approved tokens `{YYYY}` and `{####}` (minimum four digits, never truncate overflow), restricted literal ASCII, maximum display length. First issue claim freezes date/year/type and reserves the next number in one D1 batch: atomically increment/upsert sequence, INSERT reservation SELECTing that sequence, bind revision/job, append event. Uniqueness constraints prevent collisions, including patterns that omit year or overlap another type. Sequence values never decrement; retries reuse reservation. Abandoned reserved numbers remain traceable. Drafts show `下書き・未採番`. Pattern changes only affect future unreserved documents; preflight examples/collision checks plus DB uniqueness remain mandatory.

| Action | Rules |
|---|---|
| Duplicate any type | New document identity and draft; source revision relation; new date; unset number/issued/sent/payment status and due/expiry dates regenerated from copied explicit terms; deep-copy data. |
| QT → DN | Copy recipient/items, subject, delivery terms, optional amounts; clear expiry; set new issue/delivery dates for confirmation. |
| QT → INV | Copy recipient/items/subject; new invoice/transaction dates; compute due date using copied terms; issuer/bank refreshed explicitly for new document then frozen; validate invoice fields. |
| DN → INV | Same, preserving transaction/delivery date; mandatory for primary workflow even though PRD high-value list omits it. |
| INV → RC | Effective issued, fully paid invoice only; copy breakdown and payment evidence; receipt date = latest active payment date, show methods or “複数”; one active full receipt per invoice enforced atomically. |
| PO ↔ OC reference | Store source revision/external order number and role semantics per D08; no supplier impersonation or procurement flow. |

Only issued source revisions can be converted in the proposed policy; duplication permits drafts. Conversion checks organization and type allowlist, creates independent data, recalculates destination totals, sets explicit source relation. It never updates source status or fields. Multiple sales invoices from one source are permitted only with a visible prior-conversion warning; no inferred balance allocation or partial-shipment accounting. Confirm this reuse policy during review.

## 9. Tax and money specification

Classes: STANDARD_10, REDUCED_8, NON_TAXABLE (非課税), OUT_OF_SCOPE (不課税), EXEMPT (免税). The three zero-tax categories retain distinct identity and printed labels; UI never infers legal classification from product wording. Tax classification defaults can be overridden deliberately.

NTA requires rounding once per tax rate per invoice, not adding rounded tax from each item. [NTA rounding guidance](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm).

Proposed deterministic algorithm:

1. Parse positive quantity and nonnegative unit price as scaled integers, at most four decimal places. Reject NaN, exponential notation, negative lines and out-of-range values. Canonical strings at API boundary; use BigInt intermediates.
2. Calculate each price × quantity; convert to integer-yen line amount using explicit `line_rounding` (default floor). This is price-extension rounding, distinct from tax rounding. Store it in snapshot.
3. Group integer line amounts by tax class/rate. Tax-exclusive: tax for rate r = round(group_base × r / 100). Tax-inclusive: tax = round(group_gross × r / (100+r)); net = gross − tax. Zero-tax group tax = 0.
4. `tax_rounding` is floor, half-up, or ceiling for nonnegative values. Half-up means remainder ×2 ≥ denominator increments quotient. Round once for each taxable group. Mixed rates remain separate.
5. Exclusive total = sum(line amounts) + sum(group taxes). Inclusive total = sum(line amounts); subtotal (net) = total − tax. Summaries store net, gross, tax, rate/class explicitly. Do not allocate authoritative tax to individual lines.
6. Shared engine powers editor and server, with server result authoritative. Engine version and input/output stored; historical values not recalculated under future rules.

Examples: exclusive 10% base 1,001 → floor tax 100/gross 1,101; exclusive 8% base 1,001 → floor tax 80/gross 1,081; both plus non-taxable 500 → subtotal 2,502/tax 180/total 2,682. Inclusive gross 1,100 at 10% and 1,080 at 8% → net 2,000/tax 180/total 2,180. Two exclusive 10% lines of ¥5 each → group tax ¥1, never ¥0 from two per-line floors. Half-up vs floor/ceiling boundary fixtures are required.

Qualified invoice validation requires issuer name/registration number, transaction date or explicit period, transaction descriptions with reduced-rate indication, consideration grouped by rate with rates, tax per rate, recipient name. Validate registration number syntax `T` + 13 digits, without pretending that syntax verifies registration. [NTA required entries](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm). Ordinary unregistered issuer mode must not imply qualification. Tax/date/field rules live in a separately versioned validator, not components. Review statutory interpretation before production.

## 10. Payment and sales specification

Payments apply to effective issued INV only. Sum active payment transactions; no currency conversion. `outstanding = total − paid`; UNPAID if paid=0 and total>0, PARTIALLY_PAID if 0<paid<total, PAID if paid=total. Zero-total invoice has no amount due, but cannot auto-create a receipt claiming a payment. Reject overpayment, zero/negative payment, future payment date, duplicate key with different payload. Same key/same payload returns prior success. Do not require SENT before payment.

Overdue = issued invoice with outstanding>0 and due_date < today's Asia/Tokyo date. Due today is not overdue; null due_date cannot become overdue. Invoice due date is required at issue in this proposed V1. Date math never uses UTC midnight implicitly. Payment before invoice issue date may occur (prepayment); allow only with explicit confirmation/note, not silently change the invoice date.

Corrections by ADMIN: require reason, void original entry and insert replacement atomically; preserve original and audit. Recheck aggregate balance inside transaction. Block corrections that invalidate an issued receipt until a receipt correction/void policy is approved. No automatic refunds, allocations across invoices, bank reconciliation, or accounting entries.

**Visible sales definition:** `売上高は、請求日を基準とした発行済み請求書の税抜合計です。会計上の売上計上とは異なります。`

Dashboard selected month uses effective issued invoices whose invoice date is within that month: 売上高 = net sum; 請求済 = gross sum; 入金済 = all active payments against those invoices as of now; 未入金 = gross minus those payments. Display `対象月の請求に対する入金状況（現在）` so 入金済 does not mean cash received during that calendar month. An optional payment-date filter on payment history is separate from sales metrics.

Monthly sales trend groups net invoice value by invoice month; counterparty aggregation groups stable counterparty ID, uses current display name with historical name in drilldown. Archived counterparties stay included. Standalone receipts, purchase documents, quotations, deliveries, drafts and superseded revisions contribute zero. Taxes in all three zero-tax classes remain in the net base. Negative sales/cancellation handling is unresolved and must not be approximated by deleting an invoice. Sales reports are current-effective views, not immutable past accounting closes; label revisions can restate a prior month's operational totals.

## 11. Six-document field specification

All types: recipient snapshot, issue date, subject, issuer snapshot, document number/revision assigned by system, theme, notes optional; at least one line (direct receipt may use one summary line). Line schema: description required, quantity >0, unit required (default 式), unit price ≥0 unless DN amounts disabled, tax class required whenever money is present. Transaction dates use document-level date/period with optional per-line overrides. Issuer/recipient legal names required for issue. Phone/email/address fields print only when supplied. Drafts may be incomplete; issuance validator is strict.

Recipient formatter: company-only adds 御中; person path prints company + optional department + person 様, without company 御中. Department-only defaults department 御中. Explicit full-addressed-name override suppresses all automatic honorific insertion. Preview exactly what will print.

| Type | Required at issue, titles and amount | Optional / conditions / hidden fields |
|---|---|---|
| QT 見積書 | 御見積書 default or 見積書; 見積番号, 発行日, 宛名, 件名, 見積有効期限, 明細, 御見積金額, 小計/税/合計 | 納期, 納品場所, 支払条件, 備考; no invoice due date, payment history, bank block by default |
| PO 発注書 | 発注書 default or 注文書; 発注番号, 発注日, 発注先, 発注者, 件名, 明細, 発注金額, summary | 希望納期, 納品場所, 支払条件, 見積番号/external supplier quote reference, 備考; issuer is purchaser |
| OC 注文請書 | 注文請書; 注文請書番号, 受注日, 注文者, 受注者, 件名, 受注内容 (lines), summary when priced | 注文番号 or related PO, 納期, 納品場所, 支払条件, 備考; outgoing issuer is our company as accepting seller; D08 gate |
| DN 納品書 | 納品書; 納品書番号, 発行日, 納品日, 納品先, 件名, 品名/数量/単位 | 注文番号, 備考; snapshot 金額表示 ON/OFF; OFF hides prices, amount, tax and totals throughout preview/PDF, not just item column |
| INV 請求書 | 請求書; 請求番号, 請求日, 請求先, 件名, transaction date/period/details, 請求金額, tax-rate consideration/rates/taxes, 支払期限; registration when qualified | 振込先 required for bank-transfer terms; alternate payment instruction otherwise; 備考; reduced-rate star and legend; expiry/delivery instructions not printed unless in notes |
| RC 領収書 | 領収書 (spaced visually); 領収番号, 領収日, 宛名, 金額, 但し書き, 支払方法, issuer; qualified tax entries when applicable | 印影 optional; 備考; invoice/payment reference internal and optional printed reference; no payment due date or request-to-pay bank block |

Type-specific storage in `type_fields_json`: QT valid_until; PO requested_delivery_date/external_quote_number; OC accepted_date/external_order_number; DN delivery_date/external_order_number/show_amounts; RC received_date/purpose/payment_methods/evidence_reference. Shared `conditions_json`: delivery_date_or_text, delivery_place, payment_terms, payment_method. Avoid conflicting duplicate sources: issue_date maps to 請求日/発注日/受注日/領収日 for corresponding type; validator requires mirrored semantic fields to agree or derive them, never separately editable contradictory dates.

Direct RC is a recorded manual receipt, not a new invoice or sales event. User confirms money was received, enters date/method/purpose and taxable breakdown. Label source as manual; no fabricated payment transaction on an unrelated invoice. Receipt text: `上記正に領収いたしました。` Display `¥…－`. Cash paper receipts/stamp-tax handling requires business/legal review before claiming print suitability for every scenario; a digital seal does not imply legal certification.

## 12. JDS, editor, PDF, and pagination

JDS = one renderer with semantic configurations for six types, not six independent templates. Use shared Header/Recipient/Issuer/Subject/PrimaryAmount/Items/TaxSummary/Conditions/Bank/Notes/Footer primitives. Renderer accepts a fully resolved view model, not live database entities.

Document tokens: A4 portrait 210×297 mm; margins 17 mm all sides, content 176×263 mm; 4 mm spacing grid. Noto Sans JP bundled with license and fixed version/weights 400/500/700; fallback Hiragino Kaku Gothic ProN, Yu Gothic, sans-serif for app only, but PDF issuance fails if required font cannot load. Title 22 pt medium; primary amount 20 pt bold; section 9.5 pt medium; body 9 pt; metadata 8.5 pt; notes 8 pt. Tabular numerals/right-aligned monetary values; charcoal text, restrained 0.2 mm rules. Standard monochrome; Modern restrained accent in title/thin rule/primary amount only. Grayscale must preserve hierarchy. No heavy grid, decorative background, or template editor.

Header: title then recipient/issuer in two columns with number/date metadata, subject, prominent amount. Sparse documents preserve breathing room without artificially huge line rows. Footer holds number, revision and page N/M. Logo/seal bounded boxes (proposed logo 32×16 mm, seal 20×20 mm), contain fit, no overlay obscuring tax text. Snapshot sizing/theme/asset content hashes; no mutable asset URLs.

Desktop editor at 1280px+ uses roughly 45% structured input/55% preview, independently scrollable columns, saved/unsaved state, visible totals, inline validation, keyboard line navigation and product picker. Preview is an array of actual A4 pages scaled uniformly; never stretch aspect ratio. Actions 保存, PDFプレビュー, 発行. Issuance shows final content/number and pending/retry state. Mobile emphasizes list/detail/search/payment actions; viewing and limited draft fields are acceptable but no competing full mobile editor. Keyboard navigation, focus errors, accessible labels, non-color status cues, readable contrast and touch targets required.

Cloudflare supports HTML/CSS PDF generation with `@cloudflare/puppeteer` and custom fonts. Use that managed browser, not a Node-local Chromium binary, canvas screenshots, or independent PDF drawing engine. [PDF generation](https://developers.cloudflare.com/browser-run/how-to/pdf-generation/).

PDF workflow: render trusted escaped HTML from frozen model; embed font/brand assets or supply controlled asset bytes; wait for `document.fonts.ready`, verify font coverage/loading and image decode, run shared paginator, wait for layout-complete flag, call PDF with CSS A4 size (`preferCSSPageSize`), print background where required, zero browser margins because page primitives own margins. Close browser in finally. No “network idle alone proves fonts loaded.” Configure limits and retry from actual account constraints. [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/).

Pagination algorithm: same bundled script measures content in browser preview and managed Chromium after fonts load. Build explicit page boxes in mm. Reserve header/footer; first page full header, later pages compact title/recipient/document number and repeating column headings. Place whole measured rows until remaining body height is insufficient. A row taller than one page is split at text-line boundaries with continuation label and numeric values only on its first fragment. Carry taxes/totals/conditions together when they fit; otherwise move summary to next page, then paginate long notes with heading repeated. Never shrink the entire document to fit or clip overflow. Insert deliberate page breaks, avoid trailing blank page, validate content bounds before PDF. A document hitting page limit is blocked with actionable error.

Fast live preview shares primitives but different browser engines can vary; authoritative PDF preview is generated on demand from the server using the same renderer. Draft preview is labeled 下書き/未発行 and not stored as issued history. After issue always download the stored PDF bytes; never regenerate on demand under a newer renderer.

## 13. Reliable issuance and R2 storage

No atomic transaction spans D1 and R2. Implement an idempotent recoverable process, not “save then hope.”

1. Validate role, draft version, issuer/recipient/terms and type rules; recompute totals server-side. In one guarded D1 batch reserve number if necessary, freeze snapshot and proposed issued timestamp, change revision to ISSUING, create job/idempotency record, audit issuance request. If another writer won, return existing job or 409. No issued status yet.
2. Claim job using expiring lease and unique fencing token. Render only its frozen snapshot with stored template version. Browser errors/429 yield bounded exponential retries; show user-visible failure after configured retry budget (proposed 3 automatic attempts). Persist failure before returning.
3. Compute PDF SHA-256 and write to deterministic final key with conditional create, never overwriting. If existing, retrieve/verify its metadata/content hash and snapshot hash; use that artifact for retry completion. Do not regenerate and demand byte-identical PDFs: browser PDF metadata can change.
4. In a guarded D1 batch insert file metadata, mark revision ISSUED, switch effective pointer, clear draft pointer, mark job COMPLETE, append generated/issued audit and save idempotent response. Verify fencing token and active snapshot. Only now expose financial effects.
5. Recovery scheduler scans indexed unfinished jobs and reclaims expired leases. Missing R2 object → rerender; existing matching object → finalize; mismatch → stop and alert, never overwrite. An R2 write followed by D1 failure leaves a recoverable orphan, not a lost issued document. Late workers must not finalize with stale lease.

Recommended object conventions:

- `organization/{org}/documents/{issue-year}/{document-id}/revision-{n}.pdf`
- `organization/{org}/assets/{asset-id}/{sha256}.{png|jpg}`

Artifact metadata: org/document/revision/snapshot hash/renderer version, with D1 storing SHA-256, byte length, key, issue timestamp. Read authorized bytes through Worker; Content-Disposition uses sanitized Japanese-compatible filename. Hash verifies artifact integrity, not legal signing. R2 conditional operations provide overwrite protection; bucket locks can protect retained prefixes. Confirm exact lock configuration/retention with owner before enabling it. [R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

Issue job snapshots stay immutable on failure; retry same job. To change content after failed issuance, explicitly abandon the job under guarded state transition and create a replacement draft/revision, retaining reservation and failure history. Never reuse a stored artifact key for different content. Phase 0 must prove this recovery path; if safe revision handling is not implemented, allow retry only and surface administrator intervention rather than unlock edits unsafely.

## 14. Search, audit, and operational visibility

Search fields: issue date and transaction date selectors with inclusive ranges; gross total min/max; counterparty ID; document type; number/prefix; derived lifecycle/payment/overdue status. Default list displays effective issued revision or newest never-issued draft, with corrections marked; separate “履歴を含む” shows all revisions without confusing them with current liabilities. Search uses snapshot name for historical-name query and master picker for identity. Proposed text matching: normalized Unicode NFKC search keys (not modifying original displayed names), escaped LIKE literals, exact/prefix number; bounded name substring fallback. No external search service. If substring name performance becomes material, approve an indexed search design after Japanese fixtures, not unvalidated Latin tokenization.

50-row default pages, 100 maximum; keyset cursor includes sort column/id and active filter fingerprint. Date/amount boundaries validated. Sort allowlist. Status joins/aggregations prefilter relevant invoices and indexed payments; do not fetch every payment to the client. Search tests include cross-org denial, archived counterparty and historical renamed recipient.

Audit in same D1 transaction as business mutations: created, edited draft, issue requested/failed/completed, PDF generated, revision created/activated, converted, duplicated, sent, payment registered/corrected, master/settings/role changed. Record actor, UTC timestamp, entity/revision, request ID, reason and changed-field summary. Successful status cannot exist without associated event. Logs append-only in app; no full event sourcing or claim of independently tamper-proof ledger. Alert on repeated render failure, orphan mismatch, failed backup, auth failure spikes; aggregate timings without logging invoice contents.

## 15. Testing and rendering regression

| Layer | Required coverage and passing evidence |
|---|---|
| Pure domain | All tax classes; 8/10/mixed; exclusive/inclusive; floor/half-up/ceiling boundaries; fractional quantities, cap/overflow, per-rate rounding counterexample, deterministic outputs. Payments zero/partial/full/overpay; due today vs yesterday JST; sales month/year boundaries and counterparty grouping. |
| D1 integration | Fresh/upgraded migrations, FKs, triggers, org isolation, stale edits, parallel sequence allocation/pattern collision, issue locking, one correction draft, effective revision switch, conversion deep copy/relations, duplicate resets, all search fields. Test 20 simultaneous issue/payment requests, idempotent retries and race losers. |
| Issue fault injection | Browser/font failure, limit errors, client disconnect, process termination after each stage, R2 success/D1 failure, expired lease and late completion, duplicate scheduler execution, existing object mismatch. Assert one artifact and one financial effect. |
| Authorization | Real JWT verification cases (bad signature/issuer/audience/expiry), inactive member, role route matrix, forged org/ID/key, disabled user, last-admin protection, Access bypass domain checks. |
| Rendering | All six types × two themes; Japanese short/long names, long addresses, 1/20/200 lines, wrapped/oversize line, mixed rates, ¥999,999,999,999, logo/seal, optional fields omitted, DN prices hidden, receipt text and tax totals, grayscale. |
| E2E | Complete sales/purchase workflows below; settings changes preserve old documents; mobile read/search/payment; Japanese keyboard entry, validation and error recovery. |

Rendering harness saves PDF and page PNG fixtures plus PDF extracted text. Assert each page is 210×297 mm (tolerance 0.2 mm), no out-of-bounds blocks, no lost/duplicated lines, repeated headers, correct page numbers and final totals, searchable Japanese glyphs and embedded intended font. Raster thresholds calibrated to fixed browser/font versions; text assertions catch changes that pixel tolerance misses. Human inspection of every type, both themes, and dense/multipage edge cases is mandatory. Golden images cannot be blindly accepted on test failure. Record reviewer/date/issues. Browser upgrades require rerunning cloud smoke renders, not rewriting golden files automatically.

No tests executed in this planning phase because no implementation exists. Tests in this section are future acceptance obligations, not reported results.

## 16. Implementation phases and dependencies

Every phase: relevant unit/integration tests, applicable regression subset, migration verification, build/typecheck/lint, Workers compatibility smoke, applicable UI/document visual review, written deviations, scoped version-control checkpoint. If a check does not apply, record why. Architectural conflict stops dependent work: explain cause/impact, propose minimum amendment, obtain plan approval before implementing it.

| Phase | Scope and dependencies | Acceptance gate |
|---|---|---|
| 0 — feasibility and policy | After plan approval: settle repo ownership/D01–D07, account/domain/budget; isolated Cloudflare spike for D1 guards/numbering and Browser Run Japanese A4 pagination. | Actual cloud 40-page/cap fixture and font proof; timeout/429 recovery demonstrated; measured limits/cost/latency; role/financial policies signed off. If renderer fails, propose alternative before app scaffold. |
| 1 — platform | Depends 0. Scaffold React/Worker, environments, CI, auth, tenant context, migrations and test harness, setup/admin process. | Auth denial/allow matrix, API no-cache, no public bypass, staging build, fresh/upgrade DB tests, one scoped checkpoint. |
| 2 — masters and calculations | Depends 1. Organization/users/settings, contacts, counterparties/products, asset upload, domain tax/payment/sales functions, type validators. | Admin/member checks; deterministic tax vectors; explicit money/term defaults; snapshot construction tests; representative Japanese master forms reviewed. |
| 3 — shared editor/JDS | Depends 2. Six draft types, semantic fields, save/version conflicts, A4 preview/themes, pure page composition, draft PDF preview. Resolve D08 before OC. | Six rendering fixtures, both themes, multipage/no overflow, amount-hidden DN, mixed-rate invoice, recipient honorifics; initial 60s quote usability test excluding issue wait. |
| 4 — issuance/history | Depends 3. Numbering, frozen snapshots, jobs/R2, lifecycle, revisions, audit, duplicate/conversion/relationships. | Fault injection and concurrency suite passes; old PDF hashes unchanged; QT→DN→INV and PO/OC semantics correct; conversion saved within 10s at agreed load. |
| 5 — payments/search/sales | Depends 4. Payment/correction UI, RC generation gate, derived overdue, indexed search, dashboard/reports. | One full receipt only after payment; aggregate reconciliation; no double-count revisions; every search filter; retrieve target in <10s usability trial; realistic query plans. |
| 6 — hardening/release | Depends 5. Full E2E, role/security tests, visual sign-off, load/account limits, backup/restore, operational docs and training. | Production checklist below; unresolved material policies resolved; zero critical defects; approved deviations; release build and migrations recorded. |

Do not call phase 6 complete because screens exist. Do not enable invoice issuance in production before artifacts, history and payment invariants pass.

## 17. Production validation and operations

Sales E2E: ADMIN configures company/bank/registration/branding → MEMBER creates customer/contact and products (10%,8%,non-taxable) → creates QT with recipient override example → reviews actual A4 PDF → issues → converts DN (check amount toggle) → issues → converts INV → confirms transaction date/terms → issues → registers partial payment → verifies balance/overdue/date boundary → registers remaining amount → creates/issues RC → verifies references and payment evidence.

Purchase E2E: supplier marked supplier/both → outgoing PO → issue; customer purchase order reference → outgoing OC under approved D08 policy → verify source/target roles and relation. Do not “pass” by pretending supplier is our issuer.

Historical E2E: update master address/bank/product after issuance → old PDF and snapshots unchanged; duplicate → new number on issue; correction → old history remains, one effective financial revision; search by date, amount, counterparty, type, number/status → correct pages; change actor roles → permission enforcement. Exercise long-content/branding/theme edge cases in managed cloud Chromium and actual grayscale A4 print.

Release checklist:

- Plan decision register resolved or explicitly accepted limitation; no compliance marketing claim beyond `電子帳簿保存法を考慮した設計`.
- Migrations/backfill verified on staging; scoped release commit, lockfile, Worker build and renderer version recorded. No sample customer data in production.
- Access hostname/audience/IdP/users configured; direct alternate-host bypass denied; organization IDs cannot cross boundaries.
- Private R2 and retention settings validated; exact issued PDFs downloadable; hash/file metadata reconciled; interrupted jobs recovered.
- Required automated suites and human rendering sign-off recorded. Invoice tax/date/receipt policy reviewed by responsible business/tax owner.
- User performance trials: normal quote draft under 60s with master data available; QT→saved INV draft under 10s; locate existing document under 10s. Measure network/browser conditions, user count and data size; proposed benchmark 10 concurrent users, 100k historical documents, 200 lines maximum. PDF issue latency measured separately, proposed p95 ≤30s subject to phase-0 evidence.
- Alerts, support owner, recovery runbook, budget limits, Access failure procedure and issue retry UI tested. No fallback to untracked manual PDF overwrite.
- D1 recovery capability plus scheduled database export and R2 inventory/backup policy verified. D1 Time Travel is a recovery mechanism, not a statutory archive. [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/). Retain issued PDFs according to approved retention; choose independent backup destination and least-privilege credentials. Restore drill rebuilds D1 references, rechecks PDF hashes and unfinished jobs; record achieved RPO/RTO.
- Deploy during controlled window; migrate before compatible code; smoke test draft/issue/download with designated non-customer fixture; rollback Worker only if schema-compatible. Never delete genuine issued records as cleanup.

## 18. Risk register and handoff

| Risk | Mitigation / release blocker |
|---|---|
| Cloud PDF fonts/pagination differ from preview | Phase-0 actual Cloudflare spike; self-hosted fonts; shared paginator; authoritative PDF preview; visual sign-off. |
| D1/R2 split failure or concurrent issue | Durable job row, immutable snapshot/key, conditional writes, fencing, recovery, stage-by-stage fault tests. |
| Incorrect taxes | Dedicated rational engine, per-rate rounding, NTA-grounded validation, test vectors and business review. |
| Financial duplication via revisions/conversion/receipt | Effective revision pointer, receipt uniqueness, transactional checks, visible source reuse warning. |
| Purchase confirmation issuer ambiguity | D08 decision before building purchase flow. |
| Payment corrections/returns/cancellations missing | D05/D11 restrictions visible; owner-approved policy before production use, no destructive workaround. |
| Access incorrectly assumed to secure all endpoints | Signature/audience validation and role checks in Worker; disable alternate entry points; negative tests. |
| Account/browser quotas and ongoing cost | Confirm actual plan/limits and bounded documents/retries; test throttling; usage alerts. |
| Compliance overclaim | No “完全対応”; review retention/timestamps/search/audit and paper-receipt needs separately. |
| Ancestor Git pollution | Dedicated repo decision; never stage unrelated content. |

Handoff procedure: reviewer records approvals against D01–D13, signs sales definition and permissions, and approves plan version. Luna executes phase 0 first and records findings; then phase gates in order. Report each phase's files, evidence, migration/build results, cloud compatibility, visual reviews, deviations and checkpoint. Escalate incompatible requirements with smallest plan amendment; no scope expansion to CRM, inventory, accounting, OCR, AI, or workflow automation.

## 19. PRD §58 planning-output coverage

| Required outputs | Location |
|---|---|
| 1 assessment | §1 |
| 2–5 architecture/technology/Cloudflare/auth | §§3–4 |
| 6–7 modules/routes | §5 |
| 8–11 schema/relations/indexes/migrations | §§6–7 |
| 12 R2 | §13 |
| 13–18 snapshots/lifecycle/revisions/relations/conversion/numbering | §§6,8,13 |
| 19–21 tax/payment/sales | §§9–10 |
| 22–25 JDS/fields/PDF/multipage | §§11–13 |
| 26–29 search/audit/security/authorization | §§4,14 |
| 30–31 testing/rendering regression | §15 |
| 32–34 phases/dependencies/acceptance | §16 |
| 35 production validation | §17 |
| 36–38 risks/unresolved decisions/assumptions | §§2,18 |

Official references linked inline were checked during planning on 2026-09-29. Technical implementation details beyond source claims are proposed design decisions, subject to runtime validation and approval.
