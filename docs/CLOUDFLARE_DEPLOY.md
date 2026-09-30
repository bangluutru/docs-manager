# Deploy Docs Manager lên Cloudflare

Hướng dẫn đối chiếu repo và tài liệu Cloudflare ngày 2026-09-30. Triển khai bằng **Workers + Static Assets**, D1, hai R2 buckets, Browser Run (tên cũ Browser Rendering) và Cloudflare Access. Không chỉ upload `dist/client`: API, PDF và database cần Worker.

Các hostname `docs-staging.example.com`, `docs.example.com`, team `yourteam.cloudflareaccess.com` và UUID bên dưới là ví dụ, phải thay bằng tài nguyên của bạn. Repo hiện chưa cấu hình môi trường cloud và chưa deploy. Nên hoàn tất staging bằng dữ liệu thử trước khi dùng production; các acceptance PDF/auth/backup còn mở được ghi trong AUDIT_FIXES.md.

## 1. Chuẩn bị

- Tài khoản Cloudflare có domain đang active trong DNS Cloudflare; quyền quản lý Workers, D1, R2 và Zero Trust.
- Bật R2 và Browser Run trong dashboard nếu tài khoản chưa dùng. Kiểm tra billing/usage theo gói tài khoản trước khi tạo tài nguyên.
- Máy có Node.js 24, pnpm và quyền truy cập repo GitHub.

Trong thư mục repo:

```sh
git switch codex/v1-release-hardening
git pull --ff-only
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:db
pnpm exec wrangler login
pnpm exec wrangler whoami
```

`whoami` phải hiển thị đúng account. Nếu quản lý nhiều account, thêm `account_id` vào config. Không chạy script `pnpm deploy` trực tiếp khi config vẫn có DB placeholder/local vars.

## 2. Tạo tài nguyên staging

```sh
pnpm exec wrangler d1 create docs-manager-staging
pnpm exec wrangler r2 bucket create docs-manager-documents-staging
pnpm exec wrangler r2 bucket create docs-manager-assets-staging
```

Lưu `database_id` từ kết quả D1. Giữ hai R2 buckets private; PDF đi qua API kiểm tra người dùng. Không bật public `r2.dev` hoặc custom public domain cho buckets.

Production dùng tài nguyên riêng:

```sh
pnpm exec wrangler d1 create docs-manager-production
pnpm exec wrangler r2 bucket create docs-manager-documents-production
pnpm exec wrangler r2 bucket create docs-manager-assets-production
```

Không dùng database/bucket production cho staging hoặc PR preview.

## 3. Tạo Access application trước khi mở ứng dụng

Trong dashboard Cloudflare One/Zero Trust:

1. Hoàn tất team setup; ghi team domain dạng `yourteam.cloudflareaccess.com`.
2. Cấu hình phương thức đăng nhập: email One-time PIN hoặc IdP công ty.
3. Mở **Access controls → Applications → Add an application → Self-hosted** (tên menu có thể là Access → Applications).
4. Tạo app `Docs Manager Staging`, public hostname `docs-staging.example.com`, bảo vệ toàn hostname; để path trống.
5. Thêm policy **Allow**, Include **Emails** với email admin và nhân viên được phép. Không dùng Bypass/Everyone.
6. Chọn login method, lưu app. Trong cấu hình application, copy **Application Audience (AUD) tag**.
7. Tạo app production riêng cho `docs.example.com`; dùng AUD riêng.

App server kiểm tra JWT issuer/audience, sau đó kiểm tra user trong D1. Được Access cho qua chưa đồng nghĩa có tài khoản/role trong ứng dụng.

Nguồn: [Self-hosted Access app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [Application token và AUD](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

## 4. Thêm môi trường vào wrangler.jsonc

Giữ cấu hình local đang có. Thêm thuộc tính `env` ở cấp ngoài cùng (thêm dấu phẩy sau `triggers` hiện tại):

```jsonc
"env": {
  "staging": {
    "name": "docs-manager-staging",
    "workers_dev": false,
    "preview_urls": false,
    "routes": [{ "pattern": "docs-staging.example.com", "custom_domain": true }],
    "vars": {
      "APP_ENV": "staging",
      "ORGANIZATION_ID": "docs-manager-organization",
      "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
      "ACCESS_AUD": "REPLACE_WITH_STAGING_AUD"
    },
    "d1_databases": [{
      "binding": "DB",
      "database_name": "docs-manager-staging",
      "database_id": "REPLACE_WITH_STAGING_DATABASE_UUID",
      "migrations_dir": "migrations"
    }],
    "r2_buckets": [
      { "binding": "DOCUMENT_ARTIFACTS", "bucket_name": "docs-manager-documents-staging" },
      { "binding": "BRAND_ASSETS", "bucket_name": "docs-manager-assets-staging" }
    ],
    "browser": { "binding": "BROWSER" },
    "observability": { "enabled": true },
    "triggers": { "crons": ["*/5 * * * *"] }
  },
  "production": {
    "name": "docs-manager-production",
    "workers_dev": false,
    "preview_urls": false,
    "routes": [{ "pattern": "docs.example.com", "custom_domain": true }],
    "vars": {
      "APP_ENV": "production",
      "ORGANIZATION_ID": "docs-manager-organization",
      "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
      "ACCESS_AUD": "REPLACE_WITH_PRODUCTION_AUD"
    },
    "d1_databases": [{
      "binding": "DB",
      "database_name": "docs-manager-production",
      "database_id": "REPLACE_WITH_PRODUCTION_DATABASE_UUID",
      "migrations_dir": "migrations"
    }],
    "r2_buckets": [
      { "binding": "DOCUMENT_ARTIFACTS", "bucket_name": "docs-manager-documents-production" },
      { "binding": "BRAND_ASSETS", "bucket_name": "docs-manager-assets-production" }
    ],
    "browser": { "binding": "BROWSER" },
    "observability": { "enabled": true },
    "triggers": { "crons": ["*/5 * * * *"] }
  }
}
```

`ACCESS_TEAM_DOMAIN` không có `https://` hay slash cuối. AUD là audience tag, không phải application ID. Định nghĩa lại vars và resource bindings ở từng môi trường; không trông chờ kế thừa binding local. Assets/main/compatibility vẫn dùng cấu hình ngoài cùng.

Custom Domain cho phép Wrangler thiết lập routing/DNS/chứng chỉ của Worker trên zone Cloudflare; nếu hostname đang có DNS/service khác, xử lý xung đột trước. [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 5. Migrate và tạo organization cloud

Với database mới:

```sh
pnpm exec wrangler d1 migrations list DB --remote --env staging
pnpm exec wrangler d1 migrations apply DB --remote --env staging
pnpm exec wrangler d1 execute DB --remote --env staging --file docs/cloudflare-bootstrap.sql
```

File bootstrap tạo `docs-manager-organization`, organization settings và numbering sáu loại; ID phải khớp `ORGANIZATION_ID`. Migration 0001 vẫn seed `local-organization` mẫu: app cloud dùng ID riêng nên không chọn dữ liệu mẫu. Không import D1 local/demo vào production.

Với database đã có dữ liệu, export backup trước khi migrate:

```sh
pnpm exec wrangler d1 export DB --remote --env staging --output /path/outside/repo/docs-manager-staging-before-migration.sql
```

Thay `/path/outside/repo/` bằng thư mục backup thật có quyền ghi; backup chứa dữ liệu nghiệp vụ, lưu ngoài Git. [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/).

## 6. Build và deploy staging

```sh
CLOUDFLARE_ENV=staging pnpm build
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler deploy
```

**Chọn môi trường ở bước build.** Vite plugin tạo output config và `.wrangler/deploy/config.json` trỏ đến output. Sau build staging, hai lệnh deploy trên dùng output staging; không thêm `--env staging` vào deploy của Vite output. Khi đổi môi trường phải build lại. Nếu chạy `pnpm build` không có `CLOUDFLARE_ENV`, output sẽ quay về local/default.

Trước deploy thật, kiểm tra output/dry-run phải có tên `docs-manager-staging`, DB UUID cloud staging, đúng hai buckets, `APP_ENV=staging`, team/AUD đúng và workers.dev/preview tắt. [Cloudflare Environments cho Vite](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

Trong Worker dashboard kiểm tra Bindings có `DB`, `DOCUMENT_ARTIFACTS`, `BRAND_ASSETS`, `BROWSER`, `ASSETS`; Domains & Routes có hostname staging. Browser binding dùng `@cloudflare/puppeteer` đã có trong repo, không cần API key Browser riêng. [Browser Run binding](https://developers.cloudflare.com/browser-run/reference/wrangler/).

## 7. Tạo admin đầu tiên

Worker đã được deploy; organization đã tạo; email admin nằm trong Access Allow policy.

1. Tạo chuỗi ngẫu nhiên dài trong password manager, lưu làm secret của staging bằng prompt an toàn:

```sh
pnpm exec wrangler secret put SETUP_TOKEN --env staging
```

2. Mở `https://docs-staging.example.com`, đăng nhập Access bằng email admin. App có thể báo chưa provisioned: bình thường ở lần đầu.
3. Trong DevTools Console của **đúng trang này**, chạy đoạn sau; prompt sẽ hỏi token vừa tạo. Không dán token vào mã nguồn/Git/chat:

```js
(async () => {
  const token = prompt('SETUP_TOKEN staging');
  if (!token) return;
  const response = await fetch('/api/v1/setup/first-admin', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Setup-Token': token }
  });
  console.log(response.status, await response.json());
})();
```

Kết quả mong đợi: 201 và role ADMIN. Reload rồi kiểm tra `/api/v1/session` có actor đúng email/ADMIN. Endpoint không cần request body. Nếu browser chặn paste Console, đọc cảnh báo của browser và chỉ chạy đoạn đã kiểm tra trên hostname của bạn.

4. Xóa secret khi setup xong:

```sh
pnpm exec wrangler secret delete SETUP_TOKEN --env staging
```

5. Mở settings trong app, nhập tên/địa chỉ công ty và tùy chọn thuế thực tế trước khi tạo chứng từ. UI quản lý users chưa hoàn tất; thêm nhân viên cần provision D1, không chỉ thêm vào Access policy. Ví dụ SQL trong D1 Console (thay email/tên bằng dữ liệu thật):

```sql
INSERT INTO users(id,organization_id,email,display_name,role,active,created_at,updated_at)
VALUES ('member-001','docs-manager-organization','staff@example.com','Staff','MEMBER',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
```

Để `access_subject` null: server gắn subject với email đã provision ở lần đăng nhập đầu. Không tạo ADMIN hàng loạt.

## 8. Kiểm chứng staging

- Incognito truy cập hostname bị đưa tới Access login; email ngoài policy không vào được.
- `/api/v1/session` sau login trả actor/role đúng; user được Access cho qua nhưng chưa provisioned bị 403.
- Settings organization không phải công ty mẫu; tạo customer/supplier/product, lưu draft rồi reload còn dữ liệu.
- Issue PDF cho QT/DN/INV/RC/PO/OC phù hợp nghiệp vụ; kiểm tra chữ Nhật, A4, font và nhiều dòng/trang. Tải lại PDF sau reload, kiểm tra artifact có trong R2 private.
- INV có correction chưa issue vẫn xuất hiện ở unpaid; payment bị chặn tới khi correction issue hoặc abandon; kiểm tra MEMBER không thực hiện được thao tác admin.
- Khi render thất bại, UI hiện lỗi, reload vẫn có retry sau khi lease hết hạn; retry không cấp thêm số/đổi snapshot.
- Duyệt danh sách/pickers nhiều trang; kiểm tra báo cáo đối chiếu tổng tiền.
- Xem Workers Logs hoặc chạy `pnpm exec wrangler tail --env staging`; không ghi setup token/JWT vào logs.
- Xác nhận cron mỗi 5 phút. Cron hiện chỉ giải phóng lease RENDERING hết hạn, **không tự phát hành/re-render mọi job lỗi**; người dùng vẫn retry qua UI.

Chưa coi là đủ acceptance production nếu chưa kiểm chứng PDF font/pagination, auth và backup/restore trên cloud. Local tests và mocked UI không thay thế những bước này.

## 9. Deploy production sau khi staging đạt acceptance

Điền bindings/AUD/hostname production riêng trong config. Tạo/migrate/seed D1 production, rồi build production và deploy:

```sh
pnpm exec wrangler d1 migrations list DB --remote --env production
pnpm exec wrangler d1 migrations apply DB --remote --env production
pnpm exec wrangler d1 execute DB --remote --env production --file docs/cloudflare-bootstrap.sql
CLOUDFLARE_ENV=production pnpm build
pnpm exec wrangler deploy --dry-run
pnpm exec wrangler deploy
pnpm exec wrangler secret put SETUP_TOKEN --env production
```

Nếu DB đã có dữ liệu, backup trước migration như bước 5 với `--env production`. Kiểm tra dry-run chỉ ra production trước deploy. Lặp setup admin tại **hostname production** với token production riêng, xóa secret, nhập thông tin công ty và kiểm chứng lại bằng dữ liệu kiểm thử có kiểm soát. Chứng từ đã phát hành giữ lịch sử/số, nên không phát hành hàng loạt để thử trên DB nghiệp vụ.

Sau khi điền config thật, commit/push cấu hình (DB IDs/AUD/hostname không phải secret); không commit token, `.env`, `.dev.vars` hoặc backup.

## 10. Tự deploy từ GitHub (tùy chọn, sau lần CLI thành công)

Trong **Workers & Pages → docs-manager-staging → Settings → Builds**, kết nối GitHub repo `bangluutru/docs-manager`:

| Thiết lập | Giá trị staging |
|---|---|
| Branch deploy | `codex/v1-release-hardening` |
| Root directory | `/` (repo đã được đưa ra thư mục mẹ) |
| Build command | `CLOUDFLARE_ENV=staging pnpm build` |
| Deploy command | `pnpm exec wrangler deploy` |
| Node version | `24` |

Đảm bảo install dùng lockfile/pnpm. Worker name trong config/output phải khớp Worker đang kết nối. Tắt PR preview/non-production deploy nếu chưa thiết kế tài nguyên riêng. Không tự migrate database hoặc bootstrap admin trong build command. Migrate là bước release riêng có backup và review. Production kết nối branch đã được bạn chọn cho release và dùng `CLOUDFLARE_ENV=production pnpm build`; không trỏ main nếu main chưa có bản sửa.

[Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 11. Backup, update và rollback

Trước update có migration, export D1 ra nơi riêng; lưu phiên bản Git/release và có quy trình sao lưu R2 PDFs cùng metadata D1. D1 export không sao lưu objects R2. Giữ buckets private, kiểm chứng restore trong DB/buckets khác trước khi dựa vào backup cho nghiệp vụ.

Sau deploy, kiểm tra phiên bản bằng `pnpm exec wrangler deployments list --env production`; khi cần rollback code dùng `pnpm exec wrangler rollback --env production` và chọn bản phù hợp. Rollback Worker **không** rollback D1 migration hoặc R2 objects; không rollback về code không tương thích schema và không xóa lịch sử/số đã phát hành.

## Chẩn đoán nhanh

| Hiện tượng | Kiểm tra |
|---|---|
| AUTH_NOT_CONFIGURED | Runtime vars team domain/AUD bị trống hoặc build nhầm default env |
| UNAUTHENTICATED | Domain chưa qua Access, app path chỉ bảo vệ một phần, hoặc request không có assertion |
| INVALID_ACCESS_TOKEN | Team domain có scheme/slash, AUD sai app, issuer hoặc JWKS không đúng |
| USER_NOT_PROVISIONED | Chưa setup first admin hoặc email chưa có trong D1 organization |
| Lỗi foreign key lúc first-admin | Chưa chạy bootstrap SQL hoặc organization ID khác config |
| no such table/column | Migration remote chưa áp dụng trên DB đang bind |
| PDF ISSUE_FAILED | Browser binding/usage, R2/D1 hoặc render; đọc logs, retry sau lease thay vì tạo document mới |
| Binding vẫn chỉ ra local | Build thiếu CLOUDFLARE_ENV hoặc dùng output cũ |
| Deploy DNS conflict | Hostname đang thuộc DNS/service khác; kiểm tra Custom Domain |
