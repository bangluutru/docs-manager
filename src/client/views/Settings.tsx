import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type Organization, type SessionActor, type UserAccount } from "../api";
import { BANK_ACCOUNT_TYPES, bankAccountTypeLabels, DEFAULT_BANK_NOTE, DOCUMENT_TYPES, type BankAccount, type DocumentDefaults, type DocumentType } from "../../domain/document";
import { formatDocumentNumber } from "../../domain/numbering";
import { TYPE_LABELS } from "../shell";

type Tab = "company" | "documents" | "bank" | "users";
const TABS: Array<{ id: Tab; label: string; icon: string; adminOnly?: boolean }> = [
  { id: "company", label: "会社情報", icon: "▣" },
  { id: "documents", label: "帳票・採番", icon: "▧" },
  { id: "bank", label: "振込先", icon: "¥" },
  { id: "users", label: "ユーザー", icon: "◉", adminOnly: true },
];
const roundingOptions = [["floor", "切り捨て"], ["half-up", "四捨五入"], ["ceil", "切り上げ"]] as const;
const dueRuleOptions: Array<[DocumentDefaults["dueRule"], string]> = [["NEXT_MONTH_END", "翌月末"], ["MONTH_END", "当月末"], ["DAYS_30", "発行日から30日後"], ["NONE", "自動入力しない"]];

interface Props { organization: Organization | null; actor: SessionActor | null; path: string; navigate: (path: string) => void; saved: (message: string) => void }

export function Settings({ organization, actor, path, navigate, saved }: Props) {
  const requested = path.split("/")[2] as Tab | undefined;
  const tab: Tab = TABS.some((item) => item.id === requested) ? requested! : "company";
  const admin = actor?.role === "ADMIN";
  return <>
    <div className="page-heading"><div><span className="eyebrow">SETTINGS　/　設定</span><h1>設定</h1><p>帳票に印字される会社情報・振込先・採番ルールと、利用ユーザーを管理します。</p></div></div>
    {!admin && <div className="definition-note"><span>i</span><div><strong>閲覧のみ</strong><p>設定の変更は管理者のみ行えます。変更が必要な場合は管理者に依頼してください。</p></div></div>}
    <div className="settings-layout">
      <nav className="settings-nav">{TABS.filter((item) => !item.adminOnly || admin).map((item) => <button key={item.id} className={tab === item.id ? "selected" : ""} onClick={() => navigate(`/settings/${item.id}`)}>{item.icon}　{item.label}</button>)}
        <small>保存した内容は、次に作成する帳票から反映されます。作成済みの下書きは編集画面の「最新の会社情報を反映」で更新できます。</small></nav>
      {!organization ? <section className="panel settings-panel"><p className="muted">読み込み中…</p></section>
        : tab === "company" ? <CompanySettings organization={organization} admin={admin} saved={saved} />
        : tab === "documents" ? <DocumentSettings organization={organization} admin={admin} saved={saved} />
        : tab === "bank" ? <BankSettings organization={organization} admin={admin} saved={saved} />
        : <UserSettings actor={actor} saved={saved} />}
    </div>
  </>;
}

interface PanelProps { organization: Organization; admin: boolean; saved: (message: string) => void }
function useSubmit(action: () => Promise<unknown>, done: () => void) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await action(); done(); } catch (error) { setMessage(error instanceof Error ? error.message : "保存できませんでした。"); } finally { setBusy(false); }
  }
  return { busy, message, setMessage, submit };
}
function Footer({ busy, admin, note }: { busy: boolean; admin: boolean; note: string }) {
  return <div className="settings-footer"><span>{note}</span><button className="button primary" disabled={busy || !admin}>{busy ? "保存中…" : "変更を保存"}</button></div>;
}
function Heading({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return <div className="form-section-title settings-subtitle"><span className="form-step">{step}</span><div><h2>{title}</h2><p>{children}</p></div></div>;
}

function CompanySettings({ organization, admin, saved }: PanelProps) {
  const initial = () => ({ legal_name: organization.legal_name, display_name: organization.display_name, postal_code: organization.postal_code, prefecture: organization.prefecture, address: organization.address, building: organization.building, phone: organization.phone, fax: organization.fax ?? "", email: organization.email ?? "", website: organization.website ?? "", representative: organization.representative, registration_number: organization.registration_number ?? "", qualified_mode: Boolean(organization.qualified_mode) });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [organization]);
  const change = (key: keyof typeof form, value: string | boolean) => setForm((old) => ({ ...old, [key]: value }));
  const { busy, message, setMessage, submit } = useSubmit(() => api.saveOrganization(form), () => saved("会社情報を保存しました。"));
  const text = (key: Exclude<keyof typeof form, "qualified_mode">, label: string, options: { required?: boolean; full?: boolean; placeholder?: string } = {}) =>
    <label className={`field ${options.full ? "full" : ""}`}><span>{label}{options.required && <> <b>*</b></>}</span><input required={options.required} disabled={!admin} value={form[key]} placeholder={options.placeholder} onChange={(event) => change(key, event.target.value)} /></label>;
  return <form className="panel settings-panel" onSubmit={submit}>
    <div className="section-heading"><div><h2>会社情報</h2><span>帳票の発行元として印字される情報です。</span></div></div>
    <div className="field-grid">
      {text("legal_name", "会社名（正式名称）", { required: true, placeholder: "株式会社サンプル" })}{text("display_name", "表示名（アプリ内の呼称）", { required: true })}
      {text("representative", "代表者（役職・氏名）", { placeholder: "代表取締役　山田 太郎" })}{text("postal_code", "郵便番号", { placeholder: "100-0005" })}
      {text("prefecture", "都道府県", { placeholder: "東京都" })}{text("address", "住所（市区町村・番地）", { placeholder: "千代田区丸の内1-1-1" })}
      {text("building", "建物名・階", { full: true })}{text("phone", "電話番号", { placeholder: "03-1234-5678" })}{text("fax", "FAX番号")}
      {text("email", "メールアドレス", { placeholder: "info@example.co.jp" })}{text("website", "Webサイト")}
    </div>
    <div className="settings-divider" /><Heading step="02" title="インボイス制度（適格請求書）">適格請求書発行事業者の登録番号を設定すると、請求書・領収書に印字されます。</Heading>
    <div className="field-grid">
      <label className="field"><span>登録番号</span><input disabled={!admin} value={form.registration_number} placeholder="T1234567890123" pattern="T[0-9]{13}" title="「T」と13桁の数字" onChange={(event) => change("registration_number", event.target.value.trim())} /><small>「T」＋13桁の数字。未登録（免税事業者）の場合は空欄のままにします。</small></label>
      <label className="checkbox-row"><input type="checkbox" disabled={!admin} checked={form.qualified_mode} onChange={(event) => change("qualified_mode", event.target.checked)} /><span><strong>適格請求書発行事業者として発行する</strong><small>有効にすると、請求書の発行時に登録番号・取引年月日・税率別の金額を必須項目として確認します。</small></span></label>
    </div>
    <div className="settings-divider" /><Heading step="03" title="ロゴ・社印（印影）">PNGまたはJPEG、1MB以下。背景が透過または白の画像を推奨します。</Heading>
    <div className="asset-grid">
      <AssetUploader kind="logo" label="会社ロゴ" hint="発行元の社名の上に表示（最大 32×16mm）" assetId={organization.logo_asset_id} admin={admin} onChange={saved} onError={setMessage} />
      <AssetUploader kind="seal" label="社印（角印）" hint="発行元の社名の右に表示（20×20mm）" assetId={organization.seal_asset_id} admin={admin} onChange={saved} onError={setMessage} />
    </div>
    {message && <div className="inline-alert" role="alert">{message}</div>}
    <Footer busy={busy} admin={admin} note="ロゴ・社印は選択するとすぐに保存されます。" />
  </form>;
}

function AssetUploader({ kind, label, hint, assetId, admin, onChange, onError }: { kind: "logo" | "seal"; label: string; hint: string; assetId: string | null; admin: boolean; onChange: (message: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    onError("");
    if (!["image/png", "image/jpeg"].includes(file.type)) { onError("PNGまたはJPEG形式の画像を選択してください。"); return; }
    if (file.size > 1_048_576) { onError("画像は1MB以下にしてください。"); return; }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      await api.uploadBrandAsset(kind, file, bitmap.width, bitmap.height);
      bitmap.close(); onChange(`${label}を保存しました。`);
    } catch (error) { onError(error instanceof Error ? error.message : "画像を保存できませんでした。"); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.removeBrandAsset(kind); onChange(`${label}を外しました。`); } catch (error) { onError(error instanceof Error ? error.message : "変更できませんでした。"); } finally { setBusy(false); }
  }
  return <div className="asset-card">
    <div className={`asset-preview asset-${kind}`}>{assetId ? <img src={`/api/v1/brand-assets/${assetId}`} alt={label} /> : <span>未設定</span>}</div>
    <div><strong>{label}</strong><small>{hint}</small>
      <div className="asset-actions"><label className={`button secondary ${!admin || busy ? "disabled" : ""}`}>{busy ? "処理中…" : assetId ? "画像を変更" : "画像を選択"}<input type="file" accept="image/png,image/jpeg" hidden disabled={!admin || busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
        {assetId && admin && <button type="button" className="text-button" disabled={busy} onClick={() => void remove()}>使用しない</button>}</div></div>
  </div>;
}

function DocumentSettings({ organization, admin, saved }: PanelProps) {
  const initial = () => ({ default_tax_mode: organization.default_tax_mode, tax_rounding: organization.tax_rounding, line_rounding: organization.line_rounding, theme: organization.theme, accent_color: organization.accent_color, quotation_title: organization.quotation_title, purchase_order_title: organization.purchase_order_title, delivery_show_amounts: Boolean(organization.delivery_show_amounts), numbering: { ...organization.numbering }, defaults: { ...organization.defaults } });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [organization]);
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((old) => ({ ...old, [key]: value }));
  const changeDefault = <K extends keyof DocumentDefaults>(key: K, value: DocumentDefaults[K]) => setForm((old) => ({ ...old, defaults: { ...old.defaults, [key]: value } }));
  const { busy, message, submit } = useSubmit(() => api.saveDocumentSettings(form), () => saved("帳票設定を保存しました。"));
  const year = new Date().getFullYear();
  const example = (type: DocumentType) => { try { return formatDocumentNumber(form.numbering[type], year, 1); } catch (error) { return error instanceof Error ? error.message : "パターンを確認してください"; } };
  return <form className="panel settings-panel" onSubmit={submit}>
    <div className="section-heading"><div><h2>帳票・採番</h2><span>帳票のデザイン、消費税の計算方法、帳票番号のルールを設定します。</span></div></div>
    <Heading step="01" title="デザイン">STANDARD は罫線を使った伝統的なモノクロ、MODERN は余白を活かしアクセントカラーを使用します。</Heading>
    <div className="theme-picker">{(["standard", "modern"] as const).map((theme) => <label key={theme} className={`theme-card ${form.theme === theme ? "selected" : ""}`}>
      <input type="radio" name="theme" disabled={!admin} checked={form.theme === theme} onChange={() => change("theme", theme)} />
      <span className={`theme-thumb theme-thumb-${theme}`} style={theme === "modern" ? { borderTopColor: form.accent_color, color: form.accent_color } : undefined}><i>請求書</i><b /><b /><b /></span>
      <span><strong>{theme === "standard" ? "STANDARD" : "MODERN"}</strong><small>{theme === "standard" ? "明朝体タイトル・罫線表・モノクロ" : "ゴシック体・アクセントカラー"}</small></span></label>)}</div>
    <div className="field-grid">
      <label className="field"><span>アクセントカラー（MODERN）</span><div className="color-field"><input type="color" disabled={!admin} value={form.accent_color} onChange={(event) => change("accent_color", event.target.value)} /><code>{form.accent_color}</code></div></label>
      <label className="field"><span>見積書のタイトル</span><select disabled={!admin} value={form.quotation_title} onChange={(event) => change("quotation_title", event.target.value)}><option>御見積書</option><option>見積書</option></select></label>
      <label className="field"><span>発注書のタイトル</span><select disabled={!admin} value={form.purchase_order_title} onChange={(event) => change("purchase_order_title", event.target.value)}><option>発注書</option><option>注文書</option></select></label>
      <label className="checkbox-row"><input type="checkbox" disabled={!admin} checked={form.delivery_show_amounts} onChange={(event) => change("delivery_show_amounts", event.target.checked)} /><span><strong>納品書に金額を表示する（初期値）</strong><small>帳票ごとに編集画面で切り替えられます。</small></span></label>
    </div>
    <div className="settings-divider" /><Heading step="02" title="消費税の計算">端数処理は税率ごとに1回行います（インボイス制度のルール）。</Heading>
    <div className="field-grid three">
      <label className="field"><span>金額の入力方法（初期値）</span><select disabled={!admin} value={form.default_tax_mode} onChange={(event) => change("default_tax_mode", event.target.value as typeof form.default_tax_mode)}><option value="exclusive">税抜（外税）</option><option value="inclusive">税込（内税）</option></select></label>
      <label className="field"><span>消費税の端数処理</span><select disabled={!admin} value={form.tax_rounding} onChange={(event) => change("tax_rounding", event.target.value as typeof form.tax_rounding)}>{roundingOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span>明細金額の端数処理</span><select disabled={!admin} value={form.line_rounding} onChange={(event) => change("line_rounding", event.target.value as typeof form.line_rounding)}>{roundingOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="settings-divider" /><Heading step="03" title="新規作成時の初期値">新しい帳票を作成するときに自動で入力される内容です。帳票ごとに変更できます。</Heading>
    <div className="field-grid">
      <label className="field"><span>見積有効期限</span><div className="inline-field"><span>発行日から</span><input type="number" min={0} max={365} disabled={!admin} value={form.defaults.quoteValidDays} onChange={(event) => changeDefault("quoteValidDays", Math.max(0, Math.min(365, Number(event.target.value) || 0)))} /><span>日後（0 で自動入力なし）</span></div></label>
      <label className="field"><span>請求書の支払期限</span><select disabled={!admin} value={form.defaults.dueRule} onChange={(event) => changeDefault("dueRule", event.target.value as DocumentDefaults["dueRule"])}>{dueRuleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field full"><span>支払条件（見積書・注文請書）</span><input disabled={!admin} maxLength={300} value={form.defaults.paymentTerms} placeholder="例：月末締め翌月末払い（銀行振込）" onChange={(event) => changeDefault("paymentTerms", event.target.value)} /></label>
      <label className="field"><span>見積書の備考</span><textarea rows={3} disabled={!admin} maxLength={2000} value={form.defaults.quoteNotes} onChange={(event) => changeDefault("quoteNotes", event.target.value)} /></label>
      <label className="field"><span>請求書の備考</span><textarea rows={3} disabled={!admin} maxLength={2000} value={form.defaults.invoiceNotes} onChange={(event) => changeDefault("invoiceNotes", event.target.value)} /></label>
    </div>
    <div className="settings-divider" /><Heading step="04" title="帳票番号（採番ルール）">{"{YYYY}"} は発行日の年、{"{####}"} は年ごとの連番（# の数が桁数）です。使用できる文字は半角英数字・ハイフン・アンダースコアです。</Heading>
    <div className="numbering-grid">{DOCUMENT_TYPES.map((type) => <label className="field" key={type}><span>{TYPE_LABELS[type]}</span><input disabled={!admin} maxLength={40} value={form.numbering[type]} onChange={(event) => change("numbering", { ...form.numbering, [type]: event.target.value })} /><small>例：{example(type)}</small></label>)}</div>
    {message && <div className="inline-alert" role="alert">{message}</div>}
    <Footer busy={busy} admin={admin} note="発行済みの帳票の番号・デザイン・税額は変更されません。" />
  </form>;
}

function BankSettings({ organization, admin, saved }: PanelProps) {
  const [form, setForm] = useState<BankAccount>(organization.bank);
  useEffect(() => setForm(organization.bank), [organization]);
  const change = <K extends keyof BankAccount>(key: K, value: BankAccount[K]) => setForm((old) => ({ ...old, [key]: value }));
  const { busy, message, submit } = useSubmit(() => api.saveBank(form), () => saved("振込先を保存しました。"));
  return <form className="panel settings-panel" onSubmit={submit}>
    <div className="section-heading"><div><h2>振込先</h2><span>請求書の「お振込先」欄に印字される口座です。</span></div></div>
    <div className="field-grid">
      <label className="field"><span>金融機関名</span><input disabled={!admin} maxLength={60} value={form.bankName} placeholder="みずほ銀行" onChange={(event) => change("bankName", event.target.value)} /></label>
      <label className="field"><span>支店名</span><input disabled={!admin} maxLength={60} value={form.branchName} placeholder="丸の内支店" onChange={(event) => change("branchName", event.target.value)} /></label>
      <label className="field"><span>口座種別</span><select disabled={!admin} value={form.accountType} onChange={(event) => change("accountType", event.target.value as BankAccount["accountType"])}>{BANK_ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{bankAccountTypeLabels[type]}</option>)}</select></label>
      <label className="field"><span>口座番号</span><input disabled={!admin} inputMode="numeric" maxLength={20} value={form.accountNumber} placeholder="1234567" onChange={(event) => change("accountNumber", event.target.value.replace(/[^0-9]/g, ""))} /></label>
      <label className="field full"><span>口座名義（カナ）</span><input disabled={!admin} maxLength={100} value={form.accountHolder} placeholder="カ）サンプル" onChange={(event) => change("accountHolder", event.target.value)} /></label>
      <label className="field full"><span>振込に関する注記</span><input disabled={!admin} maxLength={200} value={form.note} placeholder={DEFAULT_BANK_NOTE} onChange={(event) => change("note", event.target.value)} /><small>空欄の場合は上記の定型文を印字します。</small></label>
    </div>
    {message && <div className="inline-alert" role="alert">{message}</div>}
    <Footer busy={busy} admin={admin} note="金融機関名と口座番号の両方が入力されている場合に請求書へ印字します。" />
  </form>;
}

function UserSettings({ actor, saved }: { actor: SessionActor | null; saved: (message: string) => void }) {
  const [users, setUsers] = useState<UserAccount[]>([]); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", role: "MEMBER" as "ADMIN" | "MEMBER" });
  const load = () => api.users().then(setUsers).catch((error) => setMessage(error.message));
  useEffect(() => { void load(); }, []);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage("");
    try { await action(); await load(); saved(done); } catch (error) { setMessage(error instanceof Error ? error.message : "変更できませんでした。"); } finally { setBusy(false); }
  }
  return <section className="panel settings-panel">
    <div className="section-heading"><div><h2>ユーザー</h2><span>このアプリを利用できる社員を管理します。</span></div><span className="count-pill">{users.filter((user) => user.active).length} 名</span></div>
    <div className="definition-note"><span>i</span><div><strong>ログインの仕組み</strong><p>ログインは Cloudflare Access（メールアドレス認証）で行います。ここで登録したメールアドレスを、Cloudflare Access のポリシーにも追加してください。両方に登録されたユーザーだけが利用できます。</p></div></div>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>氏名</th><th>メールアドレス</th><th>権限</th><th>状態</th><th /></tr></thead><tbody>
      {users.map((user) => <tr key={user.id} className={user.active ? "" : "row-inactive"}><td><strong>{user.display_name}</strong>{user.id === actor?.id && <small className="revision-mark">あなた</small>}</td><td>{user.email}</td>
        <td><select className="select-compact" value={user.role} disabled={busy || !user.active || user.id === actor?.id} onChange={(event) => void run(() => api.updateUser(user.id, { role: event.target.value as "ADMIN" | "MEMBER" }), "権限を変更しました。")}><option value="ADMIN">管理者</option><option value="MEMBER">メンバー</option></select></td>
        <td>{!user.active ? "停止中" : user.signed_in ? "利用中" : "未ログイン"}</td>
        <td className="right">{user.id !== actor?.id && <button className="text-button" disabled={busy} onClick={() => void run(() => api.updateUser(user.id, { active: !user.active }), user.active ? "ユーザーを停止しました。" : "ユーザーを再開しました。")}>{user.active ? "停止" : "再開"}</button>}</td></tr>)}
      {!users.length && <tr><td colSpan={5} className="muted">ユーザーが登録されていません。</td></tr>}
    </tbody></table></div>
    <div className="settings-divider" /><Heading step="＋" title="ユーザーを追加">管理者は設定・改訂・入金訂正を行えます。メンバーは帳票・取引先・商品・入金登録を行えます。</Heading>
    <form className="user-add" onSubmit={(event) => { event.preventDefault(); void run(async () => { await api.addUser(form); setForm({ email: "", displayName: "", role: "MEMBER" }); }, "ユーザーを追加しました。"); }}>
      <label className="field"><span>氏名 <b>*</b></span><input required maxLength={100} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
      <label className="field"><span>メールアドレス <b>*</b></span><input required type="email" maxLength={200} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="field"><span>権限</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "ADMIN" | "MEMBER" })}><option value="MEMBER">メンバー</option><option value="ADMIN">管理者</option></select></label>
      <button className="button primary" disabled={busy}>追加</button>
    </form>
    {message && <div className="inline-alert" role="alert">{message}</div>}
  </section>;
}
