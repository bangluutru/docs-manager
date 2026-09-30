# Japanese Business Document & Sales Management

Ứng dụng nội bộ tạo và quản lý báo giá, phiếu giao hàng, hóa đơn, biên nhận, đơn đặt hàng và xác nhận đơn hàng. Giao diện và tài liệu phát hành dùng tiếng Nhật.

## Chạy cục bộ

Yêu cầu Node.js 24 và pnpm.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev --port 8787
```

Mở <http://localhost:8787>. Chế độ demo chỉ hoạt động khi `APP_ENV=development` và hostname là localhost/loopback. Dữ liệu demo được lưu trong D1 local của Wrangler.

Nếu cần chạy migration sau đó, hãy dừng dev server trước; chạy Wrangler và Worker đồng thời có thể khóa D1 local.

Các lệnh kiểm tra:

```sh
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build
```

Kiểm tra giao diện dùng Chromium của Playwright; cài browser lần đầu bằng `pnpm exec playwright install chromium` nếu máy chưa có. Các test giao diện dùng API fixtures.

Migration `0005_audit_guards.sql` bổ sung khóa phát hành/thanh toán và chuẩn hóa giá legacy ([Khắc phục audit](docs/AUDIT_FIXES.md)); `0006_company_profile.sql` thêm cột FAX của công ty.

`pnpm test:e2e` còn xuất PDF mẫu của cả sáu loại chứng từ, hai mẫu thiết kế, vào `test-results/samples/` để kiểm tra bằng mắt.

## Phạm vi hiện tại

- Sáu loại chứng từ (見積書, 注文請書, 納品書, 請求書, 領収書, 発注書) dùng chung một renderer A4 với hai mẫu STANDARD (tiêu đề Mincho, bảng kẻ, đơn sắc) và MODERN (màu nhấn). Chứng từ có cột đơn giá, bảng thuế theo từng thuế suất, dấu ※ cho thuế suất giảm, mã đăng ký インボイス, tài khoản ngân hàng, con dấu/logo, số trang. Mẫu: [docs/samples](docs/samples).
- 設定 đầy đủ: thông tin công ty, インボイス, con dấu/logo (R2), tài khoản ngân hàng, mẫu thiết kế, làm tròn thuế, giá trị mặc định, quy tắc đánh số, người dùng và quyền.
- Danh mục đối tác và hàng hóa: thêm, sửa, lưu trữ (xóa mềm).
- Phát hành bất biến (PDF + SHA-256 trên R2), sửa đổi bằng 改訂, thanh toán/điều chỉnh, biên nhận, báo cáo doanh thu, tìm kiếm.
- Hướng dẫn trong ứng dụng (使い方ガイド, tiếng Nhật và tiếng Việt) và [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

Chi tiết đợt hoàn thiện 2026-10-01: [docs/RELEASE_2026-10-01.md](docs/RELEASE_2026-10-01.md).

Production: https://docs-manager.bangluutru.workers.dev (Cloudflare Access, D1, R2, Browser Run). Trạng thái: [docs/CLOUDFLARE_DEPLOY_STATUS.md](docs/CLOUDFLARE_DEPLOY_STATUS.md).

## Deploy Cloudflare

[Xem hướng dẫn chi tiết](docs/CLOUDFLARE_DEPLOY.md): staging/production, bindings, Access, migration, admin đầu tiên và Workers Builds.
