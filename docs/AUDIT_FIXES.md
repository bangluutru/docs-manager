# Khắc phục audit 2026-09-30

Đã triển khai các bản sửa F01–F10 trong working tree. Báo cáo gốc và probes tái hiện lỗi được giữ trong `audit-2026-09-30/` để đối chiếu; assertions cũ mô tả lỗi trước khi sửa, không dùng làm regression suite.

| Finding | Thay đổi | Kiểm chứng |
|---|---|---|
| F01 | Issue draft yêu cầu `If-Match` version; CAS và trigger rollback cả batch nếu draft đổi sau validation. Job lưu snapshot JSON bất biến cùng SHA-256; PDF dùng snapshot đã khóa. Finalization có guard và lease token chống worker cũ ghi một phần kết quả. | Race lần phát hành đầu, revision có số đã giữ, stale caller, lỗi R2/D1 và late finalizer |
| F02 | Chặn ghi thanh toán khi có correction đang mở tại API và trigger D1. Admin có thể bỏ revision với lý do, giữ lịch sử, phục hồi thanh toán trên invoice đang hiệu lực. | Payment/correction race, issue thành công sau khi chặn payment, abandon và idempotent replay |
| F03 | Hiện lỗi preview/issue, đọc trạng thái phát hành khi mở lại, polling và retry trên revision đã khóa; không PATCH lại nội dung khi retry. Ghi audit event khi issue thất bại. | UI lỗi preview, lỗi phát hành, reload/retry; Worker retry cùng snapshot và artifact |
| F04 | Validate mã đăng ký trong issuer snapshot; khi snapshot cũ, yêu cầu refresh rõ ràng. Refresh lưu edits trước, dùng CAS; correction chỉ admin refresh. | Issuer cũ bị từ chối, refresh rồi issue |
| F05 | Preview và tổng tiền cùng dùng tax mode hiện tại và rounding của snapshot. | Chromium kiểm tra exclusive/inclusive |
| F06 | Báo cáo dùng đối tác và tên recipient của effective issued revision. Đối tác trên document chỉ đổi khi correction được phát hành. | Attribution trước và sau activation |
| F07 | Danh sách mặc định dùng issued revision đang hiệu lực, giữ unpaid/payment status và cờ correction; lọc DRAFT vẫn xem bản sửa đổi. | Invoice có correction vẫn xuất hiện trong unpaid list |
| F08 | Product và document dùng chung decimal schema. Migration chuẩn hóa giá legacy có số 0 ở đầu. | Reject input không canonical; thử nâng cấp SQLite với giá legacy |
| F09 | PATCH đổi loại document trả 422. | Regression API |
| F10 | Keyset pagination với cursor ràng buộc org/filter, thứ tự có ID tiebreaker; danh sách có tải thêm, pickers có remote search và phân trang. | 105 records mỗi loại, không thiếu/trùng; cursor sai/filter đổi bị từ chối; UI chọn master ngoài trang đầu |

## Contract và migration

`POST /api/v1/documents/:id/issue` khi document còn DRAFT yêu cầu `If-Match: <version>` và `Idempotency-Key`. Retry revision ISSUING dùng lại nội dung đã đóng băng; client giữ khóa để retry. Không tự thay issuer snapshot khi phát hành.

Các danh sách documents/products/counterparties trả `{data, nextCursor}`. `limit` từ 1 đến 100, mặc định 50; truyền lại `cursor` cùng query/filter. Cursor không được dùng cho tổ chức hoặc bộ lọc khác.

Migration mới: `migrations/0005_audit_guards.sql`. Dừng dev server, sao lưu D1 local nếu có dữ liệu, rồi chạy `pnpm db:migrate:local`. Migration không xóa documents/payments. Giá product legacy được chuẩn hóa và tăng version. Snapshot JSON của job cũ có thể null; retry job cũ dùng frozen revision.

Đã export local trước migration vào `/tmp/docs-manager-before-0005.sql`; D1 local lúc kiểm tra chưa có dữ liệu nghiệp vụ/schema. Đã khởi tạo thành công migrations 0001–0005. Kiểm tra riêng nâng cấp SQLite từ 0001–0004 lên 0005 với fixture giá legacy đã pass integrity và foreign keys. Chưa áp dụng migration remote.

Nếu correction không còn cần thiết, admin mở bản correction, chọn bỏ revision và nhập lý do. Bản cũ tiếp tục có hiệu lực; revision bỏ được giữ với trạng thái ABANDONED. Không cho abandon khi job đang giữ lease còn hạn. Nếu issue lỗi, mở lại document, đợi lease hết hạn nếu cần rồi retry; không tạo document mới để thay retry.

## Kết quả kiểm tra local

- `pnpm typecheck`, `pnpm build`, `git diff --check`.
- `pnpm test`: 10 tests domain/render.
- `pnpm test:db`: 29 tests Worker/D1, gồm concurrency, rollback, snapshot, recovery, security và pagination.
- `pnpm test:e2e`: 5 tests Chromium dùng API fixtures.
- Smoke app trên D1 local đã migrate: trang chính, session, organization và ba list API trả 200 với đúng định dạng.

Worker tests dùng database test riêng. UI tests mock API, chưa chứng minh Browser Run/PDF hoặc Access thực tế trên cloud. Miniflare có warnings teardown async/WebSocket như baseline; exit code suite vẫn thành công.

## Điều kiện release còn mở

Bản sửa này đóng các lỗi F01–F10 đã tái hiện trong audit, chưa hoàn tất mọi hạng mục sản phẩm/release trong IMPLEMENTATION_PLAN.md. Vẫn cần cấu hình và kiểm chứng Access/role matrix thực tế, bindings staging/production, PDF font tiếng Nhật và pagination/layout đủ loại/theme, backup/restore, CI/observability/alerts, tải và fault injection cloud. Các workflow master/settings và policy ngày phát hành còn phải đối chiếu acceptance của kế hoạch.

Sau checkpoint audit, production đã được triển khai với D1/R2/Browser Run và Access cho hai email được chủ tài khoản cho phép. Xem CLOUDFLARE_DEPLOY_STATUS.md để phân biệt phần đã triển khai với acceptance chưa kiểm chứng; hướng dẫn và bootstrap nằm trong CLOUDFLARE_DEPLOY.md.
