import { useState } from "react";

type Language = "ja" | "vi";
interface Section { id: string; title: string; lead?: string; steps?: string[]; notes?: string[]; table?: { head: string[]; rows: string[][] } }
interface GuideContent { heading: string; intro: string; flowTitle: string; flow: string[]; toc: string; sections: Section[]; actions: { settings: string; create: string } }

const ja: GuideContent = {
  heading: "使い方ガイド",
  intro: "見積書から領収書まで、日本の商習慣に沿った帳票を作成・発行・保管するための手順をまとめています。はじめての方は「1. はじめに行う設定」から順に進めてください。",
  flowTitle: "販売業務の流れ",
  flow: ["見積書", "納品書", "請求書", "入金登録", "領収書"],
  toc: "目次",
  actions: { settings: "設定を開く", create: "見積書を作成する" },
  sections: [
    { id: "setup", title: "1. はじめに行う設定", lead: "最初に一度だけ、管理者が「設定」で会社の情報を登録します。ここで登録した内容が帳票の発行元として印字されます。",
      steps: [
        "設定 ＞ 会社情報：会社名（正式名称）、住所、電話番号、代表者を入力して保存します。",
        "設定 ＞ 会社情報：適格請求書発行事業者の場合は登録番号（T＋13桁）を入力し、「適格請求書発行事業者として発行する」を有効にします。",
        "設定 ＞ 会社情報：社印（角印）とロゴの画像を登録します（PNG／JPEG、1MB以下）。",
        "設定 ＞ 振込先：請求書に印字する銀行口座を登録します。",
        "設定 ＞ 帳票・採番：デザイン（STANDARD／MODERN）、端数処理、支払期限などの初期値、帳票番号のルールを確認します。",
        "設定 ＞ ユーザー：利用する社員のメールアドレスを登録します（Cloudflare Access のポリシーにも同じアドレスを追加します）。",
        "取引先・商品：よく使う取引先と商品を登録しておくと、帳票作成時に選ぶだけで入力できます。",
      ],
      notes: ["設定を変更しても、発行済みの帳票は変わりません。作成済みの下書きに反映したいときは、編集画面の「最新の会社情報を反映」を押します。"] },
    { id: "create", title: "2. 帳票を作成して発行する", lead: "すべての帳票は「下書き → 発行」の流れで作成します。発行すると番号が付き、PDFが保存されます。",
      steps: [
        "メニューの「帳票」＞「＋ 帳票を作成」を押し、帳票の種類を選びます。",
        "「01 基本情報」で発行日・件名などを入力します（＊は発行時に必須）。",
        "「02 宛先」で取引先マスターから選択するか、会社名を直接入力します。担当者名を入れると「様」、入れない場合は「御中」が自動で付きます。",
        "「03 明細」で品名・数量・単位・単価・税区分を入力します。商品マスターから選ぶこともできます。",
        "右側のプレビューで仕上がりを確認し、「保存」で下書き保存します。",
        "「PDFプレビュー」で実際のPDFを確認します（発行前の確認用で、番号は付きません）。",
        "内容が確定したら「発行」を押します。帳票番号が採番され、PDFが履歴として保存されます。",
        "「発行済みPDF」からPDFをダウンロードし、取引先へ送付します。送付後は「送付済みにする」で記録できます。",
      ],
      notes: ["発行済みの帳票は編集できません。修正が必要な場合は「5. 発行後の修正（改訂）」をご覧ください。", "税抜／税込は明細の下の「金額の入力方法」で切り替えます。消費税は税率ごとに合計してから1回だけ端数処理します。"] },
    { id: "types", title: "3. 帳票の種類と使い分け",
      table: { head: ["帳票", "用途", "発行時の必須項目"], rows: [
        ["見積書", "取引の前に金額・条件を提示する", "宛名、件名、見積有効期限"],
        ["注文請書", "お客様からの注文を受諾したことを通知する", "宛名、件名、受注日"],
        ["納品書", "商品・サービスを納めたことを通知する（金額の表示は任意）", "宛名、件名、納品日"],
        ["請求書", "代金を請求する。インボイス（適格請求書）に対応", "宛名、件名、支払期限、取引年月日または取引期間"],
        ["領収書", "代金を受け取ったことを証明する", "宛名、件名、但し書き"],
        ["発注書", "自社から仕入先へ注文する", "宛名（仕入先）、件名"],
      ] },
      notes: ["発行済みの帳票から次の帳票を作成できます：見積書 →「納品書へ」「請求書へ」、納品書 →「請求書へ」、全額入金済みの請求書 →「領収書を作成」。宛先や明細が引き継がれるので再入力は不要です。", "「複製」を使うと、同じ内容の下書きを新しく作成できます（毎月の請求などに便利です）。"] },
    { id: "payments", title: "4. 入金を管理する", lead: "請求書を発行すると、入金状況（未入金／一部入金／入金済）を管理できます。",
      steps: [
        "発行済みの請求書を開き、「入金日・入金額・方法」を入力して「入金を登録」を押します。分割入金は複数回登録できます。",
        "全額が入金されると「入金済」になり、「領収書を作成」ボタンが表示されます。",
        "支払期限を過ぎた未入金の請求書は、ホームの「確認が必要な請求書」と帳票一覧の「期限超過」に表示されます。",
        "登録を間違えた場合は、管理者が入金履歴の「訂正」から修正します。元の記録は履歴として残ります。",
      ],
      notes: ["「売上管理」では、請求日を基準にした月別の売上・請求・入金・未入金と、取引先別の売上を確認できます（会計上の売上計上とは異なる場合があります）。"] },
    { id: "revise", title: "5. 発行後の修正（改訂）", lead: "発行済みの帳票は証憑として保存されるため、直接書き換えることはできません。修正は「改訂」として行い、元の版も履歴に残ります。",
      steps: [
        "発行済みの帳票を開き、管理者が「改訂する」を押して改訂理由を入力します。",
        "同じ番号の「改訂1」の下書きが作成されるので、内容を修正して「発行」します。",
        "改訂をやめる場合は「改訂を取りやめる」を押します。発行済みの版がそのまま有効です。",
      ],
      notes: ["入金または領収書がある請求書は改訂できません。先に入金を訂正するか、新しい帳票で対応してください。", "過去の版のPDFは「改訂履歴」からいつでも確認できます。"] },
    { id: "invoice", title: "6. インボイス制度（適格請求書）への対応", lead: "「適格請求書発行事業者として発行する」を有効にすると、請求書に次の記載事項が印字され、不足がある場合は発行前にお知らせします。",
      table: { head: ["記載事項", "このアプリでの入力場所"], rows: [
        ["発行事業者の氏名または名称・登録番号", "設定 ＞ 会社情報"],
        ["取引年月日", "請求書の「取引年月日」または「取引期間」"],
        ["取引内容（軽減税率の対象である旨）", "明細の品名・税区分（8%は「※」を自動表示）"],
        ["税率ごとに区分して合計した対価の額・適用税率", "自動計算（税率別内訳）"],
        ["税率ごとに区分した消費税額等", "自動計算（端数処理は税率ごとに1回）"],
        ["書類の交付を受ける事業者の氏名または名称", "宛先"],
      ] },
      notes: ["領収書（現金・税抜5万円以上）を紙で交付する場合は収入印紙が必要です。印紙の貼付欄が自動で表示されます。PDFで交付する場合は不要です。", "税務上の取扱いの最終判断は、顧問税理士にご確認ください。"] },
    { id: "storage", title: "7. 保存・検索（電子帳簿保存法を考慮した設計）",
      steps: [
        "発行したPDFは改ざん検知用のハッシュ値とともに保存され、上書き・削除はできません。",
        "帳票一覧では、番号・取引先・件名で検索できます。「絞り込み」で日付・金額の範囲・取引先・状態を指定できます。",
        "作成・発行・改訂・入金などの操作は、操作者と日時が記録されます。",
      ],
      notes: ["本アプリは電子帳簿保存法の要件（検索性・真実性）を考慮して設計していますが、法令への適合を保証するものではありません。運用ルール（事務処理規程など）と合わせてご利用ください。"] },
    { id: "faq", title: "8. よくある質問",
      table: { head: ["質問", "回答"], rows: [
        ["発行ボタンを押したらエラーになった", "画面上部の赤いメッセージに不足している項目が表示されます。入力して保存し、もう一度「発行」を押してください。"],
        ["発行中のまま進まない", "しばらく待ってから画面を開き直し、「発行を再試行」を押してください。番号は重複しません。"],
        ["請求書に振込先が出ない", "設定 ＞ 振込先 を登録し、下書きで「最新の会社情報を反映」を押してください。"],
        ["社印が表示されない", "設定 ＞ 会社情報 で社印を登録し、下書きで「最新の会社情報を反映」を押してください。"],
        ["御中／様を変えたい", "宛先の「宛名の表示を指定」に、印字したい宛名をそのまま入力します。"],
        ["間違えて作成した下書きを消したい", "下書きには番号が付かないため、そのまま残しても帳票番号は欠番になりません。内容を書き換えて再利用できます。"],
        ["取引先・商品を削除したい", "取引先／商品の一覧で行を選び、「削除」を押します。発行済みの帳票には影響しません。"],
      ] } },
  ],
};

const vi: GuideContent = {
  heading: "Hướng dẫn sử dụng",
  intro: "Tài liệu này mô tả cách tạo, phát hành và lưu trữ chứng từ theo tập quán kinh doanh Nhật Bản — từ báo giá (見積書) đến biên nhận (領収書). Nếu mới dùng lần đầu, hãy làm theo thứ tự từ mục 1.",
  flowTitle: "Luồng nghiệp vụ bán hàng",
  flow: ["見積書 Báo giá", "納品書 Giao hàng", "請求書 Hóa đơn", "入金 Ghi nhận thanh toán", "領収書 Biên nhận"],
  toc: "Mục lục",
  actions: { settings: "Mở phần 設定 (Cài đặt)", create: "Tạo báo giá đầu tiên" },
  sections: [
    { id: "setup", title: "1. Thiết lập ban đầu", lead: "Quản trị viên (管理者) thiết lập một lần trong menu 設定. Thông tin này được in trên chứng từ với tư cách bên phát hành.",
      steps: [
        "設定 ＞ 会社情報: nhập tên công ty chính thức, địa chỉ, số điện thoại, người đại diện rồi bấm 変更を保存.",
        "設定 ＞ 会社情報: nếu công ty đã đăng ký 適格請求書発行事業者, nhập mã đăng ký (T + 13 chữ số) và bật 「適格請求書発行事業者として発行する」.",
        "設定 ＞ 会社情報: tải lên ảnh con dấu công ty (社印) và logo (PNG/JPEG, tối đa 1MB).",
        "設定 ＞ 振込先: đăng ký tài khoản ngân hàng sẽ in trên hóa đơn.",
        "設定 ＞ 帳票・採番: chọn mẫu thiết kế (STANDARD/MODERN), cách làm tròn thuế, giá trị mặc định (hạn thanh toán…) và quy tắc đánh số chứng từ.",
        "設定 ＞ ユーザー: đăng ký email của nhân viên được dùng ứng dụng (đồng thời thêm email đó vào policy của Cloudflare Access).",
        "取引先・商品: đăng ký sẵn đối tác và hàng hóa/dịch vụ hay dùng để chọn nhanh khi lập chứng từ.",
      ],
      notes: ["Thay đổi cài đặt không ảnh hưởng chứng từ đã phát hành. Với bản nháp đã tạo, bấm 「最新の会社情報を反映」 trong màn hình soạn để cập nhật."] },
    { id: "create", title: "2. Tạo và phát hành chứng từ", lead: "Mọi chứng từ đi theo trình tự 下書き (nháp) → 発行 (phát hành). Khi phát hành, hệ thống cấp số và lưu PDF.",
      steps: [
        "Vào 帳票 ＞ 「＋ 帳票を作成」 và chọn loại chứng từ.",
        "Mục 01: nhập ngày phát hành (発行日), tiêu đề (件名)… Trường có dấu ＊ là bắt buộc khi phát hành.",
        "Mục 02 宛先: chọn đối tác từ danh mục hoặc nhập trực tiếp. Có tên người phụ trách (担当者名) thì tự thêm 「様」, không có thì thêm 「御中」.",
        "Mục 03 明細: nhập tên hàng, số lượng, đơn vị, đơn giá, loại thuế; có thể chọn từ danh mục hàng hóa.",
        "Kiểm tra bản xem trước A4 bên phải, bấm 保存 để lưu nháp.",
        "Bấm PDFプレビュー để xem PDF thật (chỉ để kiểm tra, chưa cấp số).",
        "Khi nội dung đã chốt, bấm 発行. Số chứng từ được cấp và PDF được lưu vào lịch sử.",
        "Bấm 発行済みPDF để tải PDF gửi cho đối tác; sau khi gửi bấm 「送付済みにする」 để ghi nhận.",
      ],
      notes: ["Chứng từ đã phát hành không sửa trực tiếp được — xem mục 5.", "Chuyển giữa giá chưa thuế (税抜) và đã gồm thuế (税込) ở phần 「金額の入力方法」. Thuế được cộng theo từng thuế suất rồi làm tròn một lần."] },
    { id: "types", title: "3. Các loại chứng từ",
      table: { head: ["Chứng từ", "Mục đích", "Bắt buộc khi phát hành"], rows: [
        ["見積書 (Báo giá)", "Đưa ra giá và điều kiện trước giao dịch", "Người nhận, tiêu đề, hạn hiệu lực"],
        ["注文請書 (Xác nhận đơn hàng)", "Thông báo đã nhận đơn của khách", "Người nhận, tiêu đề, ngày nhận đơn"],
        ["納品書 (Phiếu giao hàng)", "Thông báo đã giao hàng/dịch vụ (hiển thị số tiền tùy chọn)", "Người nhận, tiêu đề, ngày giao"],
        ["請求書 (Hóa đơn)", "Yêu cầu thanh toán, đáp ứng chế độ インボイス", "Người nhận, tiêu đề, hạn thanh toán, ngày hoặc kỳ giao dịch"],
        ["領収書 (Biên nhận)", "Xác nhận đã nhận tiền", "Người nhận, tiêu đề, nội dung 但し書き"],
        ["発注書 (Đơn đặt hàng)", "Công ty mình đặt hàng nhà cung cấp", "Người nhận (nhà cung cấp), tiêu đề"],
      ] },
      notes: ["Từ chứng từ đã phát hành có thể tạo chứng từ kế tiếp: 見積書 → 納品書/請求書, 納品書 → 請求書, 請求書 đã thu đủ → 領収書. Người nhận và chi tiết được kế thừa.", "Nút 複製 tạo bản nháp mới cùng nội dung (tiện cho hóa đơn hằng tháng)."] },
    { id: "payments", title: "4. Quản lý thanh toán", lead: "Sau khi phát hành hóa đơn, có thể theo dõi trạng thái 未入金 / 一部入金 / 入金済.",
      steps: [
        "Mở hóa đơn đã phát hành, nhập ngày, số tiền, phương thức rồi bấm 「入金を登録」. Thanh toán nhiều lần thì đăng ký nhiều lần.",
        "Khi thu đủ, trạng thái thành 入金済 và xuất hiện nút 「領収書を作成」.",
        "Hóa đơn quá hạn chưa thu hiển thị ở trang chủ và bộ lọc 期限超過.",
        "Nếu nhập sai, quản trị viên dùng 訂正 trong lịch sử thanh toán; bản ghi gốc vẫn được giữ lại.",
      ],
      notes: ["Trang 売上管理 tổng hợp doanh thu, đã xuất hóa đơn, đã thu, chưa thu theo tháng và theo đối tác (tính theo ngày hóa đơn, có thể khác ghi nhận kế toán)."] },
    { id: "revise", title: "5. Sửa sau khi phát hành (改訂)", lead: "Chứng từ đã phát hành là chứng cứ nên không ghi đè. Việc sửa được thực hiện bằng bản 改訂, bản cũ vẫn lưu trong lịch sử.",
      steps: [
        "Mở chứng từ, quản trị viên bấm 「改訂する」 và nhập lý do.",
        "Bản nháp 「改訂1」 cùng số chứng từ được tạo; sửa nội dung rồi bấm 発行.",
        "Muốn hủy việc sửa, bấm 「改訂を取りやめる」; bản đã phát hành tiếp tục có hiệu lực.",
      ],
      notes: ["Hóa đơn đã có thanh toán hoặc biên nhận thì không 改訂 được.", "PDF của các bản trước xem được trong 改訂履歴."] },
    { id: "invoice", title: "6. Chế độ インボイス (適格請求書)", lead: "Khi bật 「適格請求書発行事業者として発行する」, hóa đơn in đủ các mục bắt buộc và hệ thống cảnh báo nếu còn thiếu.",
      table: { head: ["Mục bắt buộc", "Nhập ở đâu"], rows: [
        ["Tên bên phát hành và mã đăng ký", "設定 ＞ 会社情報"],
        ["Ngày giao dịch", "取引年月日 hoặc 取引期間 trên hóa đơn"],
        ["Nội dung giao dịch (đánh dấu thuế suất giảm)", "明細 — dòng 8% tự có dấu ※"],
        ["Tổng tiền theo từng thuế suất và thuế suất áp dụng", "Tự động (税率別内訳)"],
        ["Tiền thuế theo từng thuế suất", "Tự động (làm tròn một lần cho mỗi thuế suất)"],
        ["Tên bên nhận chứng từ", "宛先"],
      ] },
      notes: ["Biên nhận tiền mặt từ 50.000 yên (chưa thuế) giao bằng giấy cần dán 収入印紙; ô dán tem tự hiển thị. Gửi bằng PDF thì không cần.", "Vui lòng xác nhận cách xử lý thuế cuối cùng với kế toán thuế (税理士)."] },
    { id: "storage", title: "7. Lưu trữ và tìm kiếm",
      steps: [
        "PDF đã phát hành được lưu kèm mã băm, không thể ghi đè hay xóa.",
        "Danh sách 帳票 tìm theo số, đối tác, tiêu đề; 絞り込み lọc theo ngày, khoảng tiền, đối tác, trạng thái.",
        "Mọi thao tác tạo, phát hành, sửa đổi, thanh toán đều được ghi lại người thực hiện và thời điểm.",
      ],
      notes: ["Ứng dụng được thiết kế có cân nhắc yêu cầu của 電子帳簿保存法 nhưng không tự bảo đảm tuân thủ pháp luật; cần kết hợp với quy định vận hành nội bộ."] },
    { id: "faq", title: "8. Câu hỏi thường gặp",
      table: { head: ["Câu hỏi", "Trả lời"], rows: [
        ["Bấm 発行 thì báo lỗi", "Thông báo màu đỏ phía trên cho biết mục còn thiếu. Bổ sung, lưu rồi bấm 発行 lại."],
        ["Trạng thái 発行処理中 không thay đổi", "Chờ một lát, mở lại trang và bấm 「発行を再試行」. Số chứng từ không bị trùng."],
        ["Hóa đơn không hiện tài khoản ngân hàng", "Đăng ký tại 設定 ＞ 振込先, rồi bấm 「最新の会社情報を反映」 trên bản nháp."],
        ["Không thấy con dấu", "Tải con dấu tại 設定 ＞ 会社情報, rồi bấm 「最新の会社情報を反映」 trên bản nháp."],
        ["Muốn đổi 御中／様", "Nhập nguyên văn tên người nhận muốn in vào ô 「宛名の表示を指定」."],
        ["Muốn bỏ bản nháp tạo nhầm", "Bản nháp chưa có số nên không gây thiếu số; có thể sửa nội dung để dùng lại."],
        ["Muốn xóa đối tác/hàng hóa", "Chọn dòng trong danh sách rồi bấm 削除. Chứng từ đã phát hành không bị ảnh hưởng."],
      ] } },
  ],
};

export function Guide({ navigate }: { navigate: (path: string) => void }) {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem("jds:guide-language") === "vi" ? "vi" : "ja"));
  const content = language === "ja" ? ja : vi;
  function choose(next: Language) { setLanguage(next); try { localStorage.setItem("jds:guide-language", next); } catch { /* preference is optional */ } }
  return <div className="guide" lang={language}>
    <div className="page-heading"><div><span className="eyebrow">GUIDE　/　ヘルプ</span><h1>{content.heading}</h1><p>{content.intro}</p></div>
      <div className="language-switch" role="group" aria-label="Language"><button className={language === "ja" ? "selected" : ""} onClick={() => choose("ja")}>日本語</button><button className={language === "vi" ? "selected" : ""} onClick={() => choose("vi")}>Tiếng Việt</button></div></div>
    <section className="panel guide-flow"><strong>{content.flowTitle}</strong><ol>{content.flow.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="guide-actions"><button className="button secondary" onClick={() => navigate("/settings/company")}>{content.actions.settings}</button><button className="button primary" onClick={() => navigate("/documents/new?type=QT")}>{content.actions.create}</button></div></section>
    <div className="guide-layout">
      <nav className="guide-toc" aria-label={content.toc}><strong>{content.toc}</strong>{content.sections.map((section) => <a key={section.id} href={`#guide-${section.id}`} onClick={(event) => { event.preventDefault(); document.getElementById(`guide-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{section.title}</a>)}</nav>
      <div className="guide-body">{content.sections.map((section) => <section className="panel guide-section" id={`guide-${section.id}`} key={section.id}>
        <h2>{section.title}</h2>{section.lead && <p className="guide-lead">{section.lead}</p>}
        {section.steps && <ol className="guide-steps">{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
        {section.table && <div className="table-wrap"><table className="data-table guide-table"><thead><tr>{section.table.head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead><tbody>{section.table.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>}
        {section.notes?.map((note) => <p className="guide-note" key={note}>{note}</p>)}
      </section>)}</div>
    </div>
  </div>;
}
