# Hướng dẫn sử dụng — JDS 帳票管理

Ứng dụng tạo, phát hành và lưu trữ sáu loại chứng từ theo tập quán kinh doanh Nhật Bản: 見積書 (báo giá), 注文請書 (xác nhận đơn hàng), 納品書 (phiếu giao hàng), 請求書 (hóa đơn), 領収書 (biên nhận) và 発注書 (đơn đặt hàng). Giao diện bằng tiếng Nhật; trong ứng dụng, mục **使い方ガイド** có cùng nội dung này bằng tiếng Nhật và tiếng Việt.

Mẫu chứng từ: [請求書 STANDARD](samples/請求書-STANDARD.pdf) · [御見積書 MODERN](samples/御見積書-MODERN.pdf) · [領収書 STANDARD](samples/領収書-STANDARD.pdf)

## 1. Thiết lập ban đầu (quản trị viên, làm một lần)

| Bước | Menu | Nội dung |
|---|---|---|
| 1 | 設定 ＞ 会社情報 | Tên công ty chính thức, người đại diện, địa chỉ, TEL/FAX, email |
| 2 | 設定 ＞ 会社情報 | Mã đăng ký インボイス (T + 13 chữ số) và bật 「適格請求書発行事業者として発行する」 nếu công ty đã đăng ký |
| 3 | 設定 ＞ 会社情報 | Ảnh con dấu công ty (社印) và logo — PNG/JPEG, tối đa 1MB. Ảnh mẫu để thử: `docs/samples/sample-seal.png` |
| 4 | 設定 ＞ 振込先 | Tài khoản ngân hàng in trên hóa đơn |
| 5 | 設定 ＞ 帳票・採番 | Mẫu STANDARD/MODERN, màu nhấn, cách làm tròn thuế, giá trị mặc định (hạn báo giá, hạn thanh toán, điều kiện thanh toán, ghi chú), quy tắc đánh số |
| 6 | 設定 ＞ ユーザー | Email nhân viên được dùng ứng dụng. Phải thêm cùng email vào policy của Cloudflare Access |
| 7 | 取引先 / 商品・サービス | Đối tác và hàng hóa/dịch vụ hay dùng |

Trang chủ hiển thị danh sách 「はじめての設定」 cho tới khi các mục chính hoàn tất.

Thay đổi cài đặt **không** ảnh hưởng chứng từ đã phát hành. Bản nháp đã tạo trước đó giữ thông tin cũ; bấm **「最新の会社情報を反映」** trong màn hình soạn để cập nhật thông tin công ty, tài khoản ngân hàng, con dấu và mẫu thiết kế.

## 2. Tạo và phát hành chứng từ

1. **帳票 ＞ ＋ 帳票を作成**, chọn loại chứng từ.
2. **01 基本情報** — ngày phát hành, tiêu đề (件名) và các trường riêng của từng loại. Dấu ＊ là bắt buộc khi phát hành.
3. **02 宛先** — chọn đối tác từ danh mục hoặc nhập trực tiếp. Có 担当者名 thì in 「様」, không có thì in 「御中」; muốn tự quyết định thì nhập vào 「宛名の表示を指定」.
4. **03 明細** — tên hàng, số lượng, đơn vị, đơn giá, loại thuế (10%, 8% 軽減, 非課税, 不課税, 免税). Chọn 税抜 hoặc 税込 ở 「金額の入力方法」.
5. Kiểm tra bản xem trước A4 bên phải rồi bấm **保存**.
6. **PDFプレビュー** — xem PDF thật, chưa cấp số.
7. **発行** — cấp số, tạo PDF và lưu vĩnh viễn. Sau đó chứng từ bị khóa.
8. **発行済みPDF** để tải về và gửi; **送付済みにする** để ghi nhận đã gửi.

## 3. Luồng nghiệp vụ và chuyển đổi

`見積書 → 納品書 → 請求書 → 入金 → 領収書`

Từ chứng từ đã phát hành: 見積書 có nút 「納品書へ」「請求書へ」; 納品書 có 「請求書へ」; 請求書 đã thu đủ có 「領収書を作成」. Người nhận và chi tiết được kế thừa. 「複製」 tạo bản nháp mới cùng nội dung.

| Chứng từ | Bắt buộc khi phát hành |
|---|---|
| 見積書 | Người nhận, 件名, 見積有効期限 |
| 注文請書 | Người nhận, 件名, 受注日 |
| 納品書 | Người nhận, 件名, 納品日 |
| 請求書 | Người nhận, 件名, 支払期限; khi bật 適格請求書: 取引年月日 hoặc 取引期間 và mã đăng ký |
| 領収書 | Người nhận, 件名, 但し書き |
| 発注書 | Người nhận là 仕入先, 件名 |

## 4. Thanh toán và doanh thu

Mở hóa đơn đã phát hành → nhập 入金日, 入金額, 方法 → **入金を登録**. Thanh toán nhiều lần được. Thu đủ thì trạng thái là 入金済 và tạo được 領収書. Nhập sai thì quản trị viên dùng **訂正**; bản ghi gốc vẫn được giữ.

Hóa đơn quá hạn xuất hiện ở trang chủ và bộ lọc 期限超過. Trang **売上管理** tổng hợp theo tháng và theo đối tác, tính theo ngày hóa đơn.

## 5. Sửa sau khi phát hành (改訂)

Quản trị viên bấm **改訂する**, nhập lý do, sửa bản nháp 「改訂1」 rồi **発行**. Bản cũ và PDF cũ vẫn nằm trong 改訂履歴. Hóa đơn đã có thanh toán hoặc biên nhận thì không sửa được. **改訂を取りやめる** để hủy việc sửa.

## 6. インボイス制度

Hóa đơn in đủ: tên và mã đăng ký của bên phát hành, ngày giao dịch, nội dung (dòng 8% có dấu ※), tổng tiền và tiền thuế theo từng thuế suất (làm tròn một lần cho mỗi thuế suất), tên bên nhận. Biên nhận tiền mặt từ 50.000 yên chưa thuế có ô dán 収入印紙 (chỉ cần khi giao bản giấy).

Ứng dụng được thiết kế có cân nhắc 電子帳簿保存法 (PDF bất biến kèm mã băm, tìm theo ngày/số tiền/đối tác, nhật ký thao tác) nhưng không tự bảo đảm tuân thủ pháp luật. Cách xử lý thuế cuối cùng cần xác nhận với 税理士.

## 7. Phân quyền

| | 管理者 (ADMIN) | メンバー (MEMBER) |
|---|---|---|
| Chứng từ, đối tác, hàng hóa, ghi nhận thanh toán | ✓ | ✓ |
| Cài đặt công ty, ngân hàng, đánh số, người dùng | ✓ | chỉ xem |
| 改訂, sửa thanh toán (訂正) | ✓ | — |

## 8. Xử lý sự cố

| Tình huống | Cách xử lý |
|---|---|
| Bấm 発行 báo lỗi | Đọc thông báo đỏ phía trên, bổ sung mục còn thiếu, lưu và bấm lại |
| Kẹt ở 発行処理中 | Mở lại trang, bấm 「発行を再試行」; số không bị trùng |
| Hóa đơn thiếu 振込先 hoặc con dấu | Đăng ký trong 設定 rồi bấm 「最新の会社情報を反映」 trên bản nháp |
| Báo 「管理者に利用登録を依頼してください」 khi đăng nhập | Email chưa có trong 設定 ＞ ユーザー |
