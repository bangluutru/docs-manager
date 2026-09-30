# Review và audit Docs Manager — 2026-09-30 (JST)

## Kết quả và phạm vi

**Cần xử lý các lỗi P1 trước khi xem xét release.** Audit ghi nhận 10 findings: 5 P1 và 5 P2. Chín findings có probe tái hiện; phân trang được xác nhận qua code. Chưa sửa source code, chưa triển khai, chưa chạy migration remote.

Repo được audit: `/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager`.
Commit: `b5b5c4b8a2d8a08fa025af4abc1ecd982e62ec2a` trên nhánh `codex/v1-release-hardening`.
Remote: [bangluutru/docs-manager](https://github.com/bangluutru/docs-manager/tree/codex/v1-release-hardening).

Đã fetch/prune và chạy `git push origin HEAD`: `Everything up-to-date`; `git ls-remote` xác nhận SHA nhánh remote trùng HEAD. Working tree sạch trước audit. Không tạo commit rỗng, không merge nhánh main. Báo cáo/evidence nằm ngoài Git checkout để giữ source nguyên trạng.

Phạm vi đã đọc: toàn bộ Worker/Hono, domain calculations, JDS renderer, client API/router/views/styles, bốn migrations, tests, config và kế hoạch/README. Ưu tiên correctness nghiệp vụ, race conditions, snapshots, recovery, authorization và khả năng sử dụng.

## Bằng chứng kiểm tra

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| pnpm typecheck | Pass | Type safety không chứng minh nghiệp vụ đúng |
| pnpm test | 10/10 pass | Suite domain/render sẵn có |
| pnpm test:db, trước probes | 11/11 pass | Local Workers/D1/R2/Browser emulator |
| pnpm build | Pass | Worker và client build thành công |
| Audit Worker probes | 7 probe lỗi + 3 probe security pass | Assertion chứng minh lỗi hiện tại, không phải tiêu chí behavior đúng |
| pnpm test:db, gồm probes | 21/21 pass | 11 test cũ + 10 probes bổ sung |
| Chromium UI probes | Ba scenario tái hiện | API fixture, không phải production E2E |
| git diff --check | Pass | Source không đổi |

Local Miniflare vẫn log `WebSocket send() after close()` và cảnh báo async event handler lúc teardown. Tests trả exit code 0; warning này cần theo dõi nhưng không được dùng làm finding lỗi nghiệp vụ của ứng dụng.

Probe A07 điều khiển deterministic interleaving bằng DB Proxy; PATCH và issuance đều chạy handler thật. Các probe Worker dùng database test được migrations tạo, không ghi dữ liệu audit vào database production. UI probes dùng Chromium + mocked responses.

## Findings theo ưu tiên

### F01 — [P1] Khóa phát hành không ràng buộc version đã được validation

**Vị trí:** [src/server/index.ts:620](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:620); [src/server/index.ts:633](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:633).

**Bằng chứng:** Probe A07 chèn một PATCH thật ngay trước batch chuyển DRAFT → ISSUING. Bản đầu hợp lệ; PATCH version 1 → 2 xóa subject và dueDate. Issue vẫn trả 200, revision trở thành ISSUED với subject rỗng và due_date NULL. Probe dùng Proxy của DB để điều khiển thứ tự hai request, không sửa logic ứng dụng.

**Ảnh hưởng / nguyên nhân:** Validation và snapshot_hash lấy từ lần đọc cũ; UPDATE state chỉ kiểm tra DRAFT, không kiểm tra version. Sau đó renderer đọc lại revision mới. PDF có thể chứa nội dung chưa được kiểm tra và hash snapshot không đại diện nội dung đã render.

**Hướng sửa và acceptance:** Ràng buộc state + version trong cùng batch, dùng guard gây rollback nếu CAS thất bại. Khóa xong phải render đúng snapshot đã kiểm tra. Chặn request phát hành từ phiên bản màn hình cũ. Acceptance: interleaving của A07 phải trả 409 và không để lại reservation/job của lần thất bại.

### F02 — [P1] Thanh toán sau khi tạo bản sửa đổi làm phát hành kẹt

**Vị trí:** [src/server/index.ts:383](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:383); [migrations/0002_payment_guards.sql:81](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/migrations/0002_payment_guards.sql:81).

**Bằng chứng:** Probe A05: phát hành INV → tạo revision draft → ghi nhận 100 yen vào invoice đang có hiệu lực (201) → issue revision mới (500). Revision mới giữ ISSUING, job FAILED với lỗi effective revision guard.

**Ảnh hưởng / nguyên nhân:** Payment trigger cho phép thêm tiền vào invoice cũ trong lúc đang có bản sửa đổi; finalize lại cấm thay current_issued_revision_id khi tồn tại payment. Bản sửa đổi đã bị đóng băng, chưa có API hủy/abandon để thoát trạng thái này. Retry thông thường vẫn vướng payment guard; invoice cũ vẫn có hiệu lực và payment không bị mất.

**Hướng sửa và acceptance:** Quyết định một chính sách nhất quán: chặn payment khi có revision DRAFT/ISSUING bằng DB guard, hoặc cho phép payment và có luồng abandon/reconcile bản sửa đổi. Recheck trước reserve/render, đồng thời giữ invariant tại DB. Acceptance: chuỗi A05 không tạo một working revision bị kẹt.

### F03 — [P1] Phát hành lỗi bị ẩn và không có retry sau reload

**Vị trí:** [src/client/views/DocumentEditor.tsx:63](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/client/views/DocumentEditor.tsx:63); [src/client/views/DocumentEditor.tsx:74](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/client/views/DocumentEditor.tsx:74); [src/server/index.ts:813](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:813).

**Bằng chứng:** UI02 dùng Chromium với API trả ISSUE_FAILED/500: không xuất hiện alert. UI03 tải document có state ISSUING: số nút phát hành = 0, số nút retry = 0. Hai probe UI dùng API fixture để tái hiện chính xác response/state lỗi, không phải cloud fault injection.

**Ảnh hưởng / nguyên nhân:** issueDocument và previewPdf nuốt catch. Khi tải lại, locked=true cho ISSUING và UI chỉ cho issue khi !locked. Bấm lại trước reload cũng phải PATCH qua save(), nên bản đã đóng băng bị DOCUMENT_LOCKED trước khi đến issue retry. Scheduler chỉ reset lease của RENDERING; không tự chạy renderer/finalize.

**Hướng sửa và acceptance:** Hiển thị lỗi server, reload trạng thái sau lỗi và thêm action retry gọi thẳng issue cho revision ISSUING/job FAILED, không gọi save. Bổ sung job status/polling và recovery theo quyền. Acceptance: lỗi Browser/R2 hiện thông báo và người dùng retry được sau reload.

### F04 — [P1] Validation registration number khác snapshot thực sự xuất PDF

**Vị trí:** [src/server/index.ts:243](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:243); [src/server/index.ts:595](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:595).

**Bằng chứng:** Probe A01: tạo draft khi chưa có registration_number → bật qualified_mode và đặt T1234567890123 → issue trả 200. GET document cho issuer.registrationNumber=null, renderDocumentHtml của revision phát hành không chứa số đã cấu hình.

**Ảnh hưởng / nguyên nhân:** Validation kiểm tra organization_settings hiện tại nhưng renderer lấy issuer_snapshot_json lúc tạo draft. Snapshot có thể thiếu hoặc giữ registration number cũ trong khi bước validation đã pass. Đây là lỗi nhất quán output; audit này không kết luận pháp lý hay thuế.

**Hướng sửa và acceptance:** Validation theo chính snapshot phát hành, lưu qualified mode cùng snapshot. Cho refresh issuer draft có chủ đích trước khi khóa, hoặc chặn issue và hướng dẫn tạo/refresh draft. Acceptance: A01 phải chặn phát hành hoặc PDF chứa số đã xác nhận.

### F05 — [P1] Đổi thuế làm tổng trên form và preview khác nhau

**Vị trí:** [src/client/views/DocumentEditor.tsx:36](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/client/views/DocumentEditor.tsx:36); [src/client/views/DocumentEditor.tsx:40](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/client/views/DocumentEditor.tsx:40).

**Bằng chứng:** UI01 mở INV đã lưu với tax mode exclusive, đơn giá 1000 yen, thuế 10%. Chọn 税込: form hiện tổng ¥1,000, iframe preview vẫn hiện ¥1,100.

**Ảnh hưởng / nguyên nhân:** Form tính theo data.taxMode nhưng vm.tax ưu tiên savedSnapshot.tax, bao gồm mode cũ. Renderer tính theo view.tax, còn một phần trình bày lại đọc data.taxMode. Điều này tạo preview khác dữ liệu sắp lưu/phát hành.

**Hướng sửa và acceptance:** Giữ rounding từ snapshot nhưng luôn lấy mode từ data.taxMode của draft. Dùng cùng tax settings cho totals và preview. Acceptance: chuyển exclusive ↔ inclusive trên draft đã lưu cho kết quả đồng nhất với server/PDF.

### F06 — [P2] Lưu bản sửa đổi chuyển doanh thu lịch sử sang đối tác khác

**Vị trí:** [src/server/index.ts:506](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:506); [src/server/index.ts:789](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:789).

**Bằng chứng:** Probe A04: issue INV cho đối tác A → tạo revision draft → PATCH draft sang B → chưa issue bản mới. sales/counterparties đã ghi 1000 yen doanh thu của invoice cũ cho B.

**Ảnh hưởng / nguyên nhân:** Draft PATCH cập nhật documents.counterparty_id. Báo cáo nối revision đang issued nhưng lấy ID/tên đối tác từ documents/master hiện tại. Nhận diện bên mua của doanh thu thay đổi trước khi bản sửa đổi có hiệu lực.

**Hướng sửa và acceptance:** Lấy counterparty_id từ effective issued revision cho báo cáo tài chính. Nếu cần tên master hiện tại, trình bày riêng với tên snapshot. Acceptance: A04 vẫn ghi doanh thu cho A đến khi revision mới được phát hành.

### F07 — [P2] Bản sửa đổi chưa phát hành che invoice khỏi tìm kiếm công nợ

**Vị trí:** [src/server/index.ts:328](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:328).

**Bằng chứng:** Probe A03: issue INV chưa thanh toán → tạo revision draft → documents?status=UNPAID không trả invoice này. sales/summary vẫn tính công nợ của invoice có hiệu lực.

**Ảnh hưởng / nguyên nhân:** List dùng COALESCE(active_draft_revision_id,current_issued_revision_id), nên chỉ xét state DRAFT và mất payment_status/overdue của bản đã phát hành. Người dùng có thể bỏ sót invoice có hiệu lực khi tìm công nợ hoặc lọc ISSUED.

**Hướng sửa và acceptance:** Mặc định list/search tài chính lấy effective issued revision, thêm cờ có bản sửa đổi; cho xem drafts/history qua lựa chọn rõ ràng. Acceptance: cùng invoice xuất hiện trong unpaid search và đối chiếu được với summary khi correction chưa issue.

### F08 — [P2] Giá được master chấp nhận nhưng không dùng được trong chứng từ

**Vị trí:** [src/server/index.ts:123](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:123); [src/domain/document.ts:20](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/domain/document.ts:20).

**Bằng chứng:** Probe A06: POST product có unitPrice="001000" trả 201. Reuse giá đó trong POST document trả 422. ProductInput cho phép số 0 dẫn đầu, DocumentLineSchema/parseDecimal không cho phép.

**Ảnh hưởng / nguyên nhân:** Người dùng tạo được sản phẩm nhưng chọn vào editor sẽ làm preview không hợp lệ và không lưu được. Master price cũng thiếu cùng giới hạn độ dài/giá trị của draft.

**Hướng sửa và acceptance:** Dùng chung decimal schema/normalizer và giới hạn cho product/draft. Acceptance: master từ chối input không dùng được hoặc normalize 001000 thành 1000 trước khi lưu.

### F09 — [P2] PATCH nhận đổi document type nhưng âm thầm bỏ qua

**Vị trí:** [src/server/index.ts:489](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:489); [src/server/index.ts:502](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:502).

**Bằng chứng:** Probe A02 tạo QT rồi PATCH payload type=INV: API trả 200 nhưng GET vẫn type=QT. UI hiện khóa select type ở màn edit nên lỗi này được tái hiện qua API, không được báo là thao tác UI thông thường.

**Ảnh hưởng / nguyên nhân:** DraftDocumentSchema chấp nhận type, nhưng UPDATE không đổi documents.type và không kiểm tra bằng type hiện hữu. Client tích hợp có thể tin đã đổi loại trong khi issue vẫn dùng số và validation loại cũ.

**Hướng sửa và acceptance:** Đánh dấu type là identity bất biến sau create và trả 422/409 nếu payload khác type hiện hữu; hoặc bỏ type khỏi schema PATCH. Acceptance: A02 không trả success giả.

### F10 — [P2] Danh sách bị cắt ở 100 bản ghi, không có phân trang

**Vị trí:** [src/server/index.ts:330](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:330); [src/server/index.ts:149](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/server/index.ts:149); [src/client/api.ts:68](/Users/tranhaibang/.gemini/antigravity-ide/scratch/docs-manager/src/client/api.ts:68).

**Bằng chứng:** Xác nhận qua SQL/API/client: documents, counterparties và products đều LIMIT 100; response chỉ có data; không có cursor/next page ở client. Đây là finding từ đọc code, chưa load-test 100k bản ghi.

**Ảnh hưởng / nguyên nhân:** Khi vượt 100 bản ghi, không thể duyệt đầy đủ kết quả. Picker trong editor chỉ gọi masters với query rỗng, nên đối tác/sản phẩm ngoài 100 kết quả đầu không thể chọn từ danh sách.

**Hướng sửa và acceptance:** Thêm keyset pagination và nextCursor cho list, master picker có remote search. Acceptance: với 101+ bản ghi, duyệt đủ không thiếu/trùng và chọn được master ngoài trang đầu.

## Điểm đã kiểm tra và cơ sở tốt

- Decimal/tax engine dùng BigInt và rounding theo nhóm; domain tests sẵn có pass.
- Stale draft PATCH có write guard làm D1 batch rollback; frozen items/revisions và lịch sử payment/receipt có triggers bảo vệ.
- Payment insert, correction, conversion và issuance có idempotency; R2 artifact có conditional create và metadata SHA-256.
- SQL dùng bind parameters, lookup nghiệp vụ có organization scope, text JDS được HTML-escape.
- Security probes S01–S03 xác nhận demo auth không bật trên host ngoài local, Origin khác bị 403 và lookup document thuộc org khác bị 404. Chưa test chữ ký/audience/issuer/expiry JWT thật hoặc role matrix với Cloudflare Access.

## Khoảng trống và điều kiện vận hành còn mở

Các mục sau là limitation/gap được ghi riêng, không được coi là thêm finding đã tái hiện:

1. **Production chưa cấu hình:** wrangler còn DB placeholder, APP_ENV development và Access audience/team trống. README đã nói rõ. Cần env staging/production, resource bindings và identity thực tế trước release.
2. **PDF chưa đạt bộ acceptance trong plan:** renderer chỉ dựng một `.sheet`, chưa có paginator/page counters đầy đủ; không nhúng `@font-face` vào HTML PDF/iframe dù font Noto được import ở stylesheet app. Chưa có bằng chứng font cloud, Japanese glyph embedding, 40 pages/cap, không tràn/chồng footer, bản in A4 thực tế hay fixtures 6 loại × 2 themes.
3. **Nội dung PDF/master chưa đủ phạm vi plan:** snapshot bank có trong D1 nhưng không đi qua view model/render; settings bank/numbering/users vẫn disabled; master chưa có update/archive/contact workflows. Bảng PDF chưa hiện unit price và base amount theo từng nhóm thuế. Cần đối chiếu acceptance nghiệp vụ với owner, không gọi UI có màn hình là đã hoàn thành.
4. **Recovery/load còn thiếu bằng chứng:** chưa fault-inject từng stage R2/D1/lease expiry, retry scheduler, 20 request đồng thời, 100k historical docs hoặc đo latency cloud. A07/A05 cho thấy happy-path tests chưa đủ.
5. **Observability/CI:** chưa thấy workflow CI, lint script, structured issue-failed audit event hoặc alert/backup/restore runbook đầy đủ. Worker có console logging nhưng config chưa bật observability; lưu lại renderer/runtime versions và test artifact khi làm release.
6. **UX/data freshness:** shell chỉ refresh list theo query/filter/settings refresh, không invalidate sau mutation chứng từ; không có dirty-state warning; một số lỗi fetch bị thay bằng danh sách trống/zero metrics. Chưa đo mức ảnh hưởng qua E2E nên để follow-up.
7. **Policy chưa enforce đủ:** draft/issue chưa chặn ngày phát hành tương lai theo D06; cần xác nhận quyết định business trước khi thêm guard. Không suy ra đây là vấn đề pháp lý.

Current Cloudflare guidance được đối chiếu tại [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). `npm view @cloudflare/workers-types version` trả `5.20260929.1`, trùng bản repo đang dùng; đã đối chiếu types và schema Wrangler local. Không đưa kết luận về quota/pricing hay cloud compatibility từ emulator.

## Thứ tự xử lý đề xuất

1. F01/F02: khóa version + giữ consistency của revision/payment; thêm negative concurrency tests và rollback assertions.
2. F03/F04/F05: recovery UI, validation snapshot phát hành và preview/total đồng nhất.
3. F06/F07: dùng effective revision trong reporting/search; đối chiếu tổng công nợ và đối tác.
4. F08/F09/F10: contract validation, decimal shared schema và pagination/picker search.
5. Hoàn thành auth/cloud PDF/fault injection/backup và CI gates còn mở; rerun bộ acceptance trước release.

## Tái chạy evidence

`audit-probes.workers.test.ts`, `audit-ui.mjs`, `worker-evidence.log` và `ui-evidence.jsonl` được lưu cạnh báo cáo. Probe source được copy ra khỏi checkout sau khi chạy; không thay tests/source đang tracked.

Để chạy Worker probes: copy `audit-probes.workers.test.ts` vào `test/` trong checkout và chạy `pnpm test:db`, sau đó xóa bản copy. Test assertions ghi nhận behavior lỗi hiện tại; sau khi sửa ứng dụng cần đổi thành regression assertions của behavior mong muốn. Bộ security probes có thể giữ nguyên.

UI script cần được chạy từ checkout với @playwright/test; nó mở localhost:8799 và dùng Chromium executable trong cache của máy audit. Nó mock API, không yêu cầu migrate local D1. Nếu chạy máy khác, thay executablePath/port theo môi trường.
