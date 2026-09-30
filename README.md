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

Migration `0005_audit_guards.sql` bổ sung khóa phát hành/thanh toán và chuẩn hóa giá legacy. Chi tiết thay đổi, retry và bỏ correction: [Khắc phục audit](docs/AUDIT_FIXES.md).

## Phạm vi hiện tại

Luồng tạo và phát hành bán hàng, lịch sử PDF, thanh toán/điều chỉnh, biên nhận, báo cáo và tìm kiếm hoạt động trong môi trường local. 発注書 (PO) được phát hành từ công ty tới nhà cung cấp; 注文請書 (OC) được phát hành từ công ty tới khách hàng để xác nhận đã nhận đơn. Cả hai dùng luồng đánh số, PDF và lưu trữ chung, đồng thời kiểm tra đúng vai trò đối tác.

Production đã deploy tại https://docs-manager.bangluutru.workers.dev với Cloudflare Access, D1, R2 và Browser Run. Xem [trạng thái triển khai và các bước kiểm chứng còn lại](docs/CLOUDFLARE_DEPLOY_STATUS.md); backup/restore và các cổng release còn cần hoàn tất.

## Deploy Cloudflare

[Xem hướng dẫn chi tiết](docs/CLOUDFLARE_DEPLOY.md): staging/production, bindings, Access, migration, admin đầu tiên và Workers Builds.
