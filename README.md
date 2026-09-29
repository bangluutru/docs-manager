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
pnpm build
```

## Phạm vi hiện tại

Luồng tạo và phát hành bán hàng, lịch sử PDF, thanh toán/điều chỉnh, biên nhận, báo cáo và tìm kiếm hoạt động trong môi trường local. 発注書 (PO) được phát hành từ công ty tới nhà cung cấp; 注文請書 (OC) được phát hành từ công ty tới khách hàng để xác nhận đã nhận đơn. Cả hai dùng luồng đánh số, PDF và lưu trữ chung, đồng thời kiểm tra đúng vai trò đối tác.

Cloudflare Access, tài nguyên D1/R2/Browser Run thật, miền triển khai, sao lưu và quy trình khôi phục chưa được cấu hình. Không chạy lệnh `--remote` hoặc deploy cho tới khi hoàn thành các cổng vận hành trong kế hoạch.
