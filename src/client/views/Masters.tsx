import { useEffect, useRef, useState } from "react";
import { api, type Counterparty, type Product } from "../api";
import { taxLabels } from "../../domain/document";
import type { TaxClass } from "../../domain/tax";

type Kind = "counterparties" | "products";
type Row = Counterparty | Product;
const taxOptions = Object.entries(taxLabels) as Array<[TaxClass, string]>;

export function Masters({ kind }: { kind: Kind }) {
  const counterparty = kind === "counterparties";
  const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState(""); const [saved, setSaved] = useState(""); const [query, setQuery] = useState("");
  // `editing` is the record in the form: null = form closed, "new" = creating.
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [activeQuery, setActiveQuery] = useState(""); const generation = useRef(0);
  async function load(q = query, cursor?: string) {
    const ticket = cursor ? generation.current : ++generation.current; setBusy(true); setError("");
    try {
      const page = counterparty ? await api.counterpartiesPage(q, "all", cursor) : await api.productsPage(q, cursor); if (ticket !== generation.current) return;
      setRows((old) => cursor ? [...old, ...page.data] : page.data); setNextCursor(page.nextCursor); setActiveQuery(q);
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : "読み込めませんでした"); } finally { if (ticket === generation.current) setBusy(false); }
  }
  useEffect(() => { setRows([]); setQuery(""); setNextCursor(null); setEditing(null); void load(""); return () => { generation.current++; }; }, [kind]);
  function notify(message: string) { setSaved(message); window.setTimeout(() => setSaved(""), 3000); }
  async function submit(form: HTMLFormElement) {
    const fd = new FormData(form); const v = (key: string) => String(fd.get(key) ?? ""); const target = editing !== "new" && editing ? editing.id : null;
    const body = counterparty
      ? { name: v("name"), kana: v("kana"), isCustomer: fd.has("customer"), isSupplier: fd.has("supplier"), postalCode: v("postal"), prefecture: v("prefecture"), address: v("address"), building: v("building"), phone: v("phone"), email: v("email"), notes: v("notes") }
      : { code: v("code"), name: v("name"), description: v("description"), unit: v("unit"), unitPrice: v("price"), taxClass: v("taxClass") };
    if (counterparty && !fd.has("customer") && !fd.has("supplier")) { setError("取引区分（得意先・仕入先）を1つ以上選択してください。"); return; }
    try {
      if (counterparty) await (target ? api.updateCounterparty(target, body) : api.addCounterparty(body));
      else await (target ? api.updateProduct(target, body) : api.addProduct(body));
      setEditing(null); notify(target ? "変更を保存しました。" : "登録しました。"); setQuery(""); void load("");
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした"); }
  }
  async function archive(row: Row) {
    if (!window.confirm(`「${row.name}」を一覧から削除します。発行済みの帳票には影響しません。続けますか？`)) return;
    try { await (counterparty ? api.archiveCounterparty(row.id) : api.archiveProduct(row.id)); setEditing(null); notify("削除しました。"); void load(activeQuery); }
    catch (e) { setError(e instanceof Error ? e.message : "削除できませんでした"); }
  }
  const partner = counterparty && editing && editing !== "new" ? editing as Counterparty : null;
  const product = !counterparty && editing && editing !== "new" ? editing as Product : null;
  return <><div className="page-heading"><div><span className="eyebrow">MASTER DATA　/　{counterparty ? "PARTNERS" : "PRODUCTS"}</span><h1>{counterparty ? "取引先" : "商品・サービス"}</h1><p>{counterparty ? "お客様・仕入先の情報をまとめて管理します。" : "よく使う品名や価格を帳票の明細に再利用できます。"}</p></div><button className="button primary" onClick={() => { setEditing(editing === "new" ? null : "new"); setError(""); }}>＋ {counterparty ? "取引先を追加" : "商品を追加"}</button></div>
    {editing && <section className="panel master-form-panel"><div className="section-heading"><div><h2>{editing === "new" ? (counterparty ? "取引先を追加" : "商品・サービスを追加") : `${editing.name} を編集`}</h2><span>入力した情報は帳票作成時に選択できます。変更しても発行済みの帳票は変わりません。</span></div><button className="icon-button" aria-label="閉じる" onClick={() => setEditing(null)}>×</button></div>
      <form key={editing === "new" ? "new" : editing.id} onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}><div className="field-grid">{counterparty ? <>
        <label className="field"><span>会社名 <b>*</b></span><input name="name" required maxLength={200} placeholder="株式会社ABC" defaultValue={partner?.name} /></label><label className="field"><span>会社名かな</span><input name="kana" maxLength={200} defaultValue={partner?.kana} /></label>
        <label className="field"><span>郵便番号</span><input name="postal" placeholder="100-0001" maxLength={20} defaultValue={partner?.postal_code} /></label><label className="field"><span>都道府県</span><input name="prefecture" placeholder="東京都" maxLength={30} defaultValue={partner?.prefecture} /></label>
        <label className="field full"><span>住所</span><input name="address" maxLength={300} defaultValue={partner?.address} /></label><label className="field full"><span>建物名・階</span><input name="building" maxLength={200} defaultValue={partner?.building} /></label>
        <label className="field"><span>電話番号</span><input name="phone" maxLength={40} defaultValue={partner?.phone} /></label><label className="field"><span>メール</span><input name="email" type="email" maxLength={200} defaultValue={partner?.email} /></label>
        <fieldset className="field full"><legend>取引区分 <b>*</b></legend><label className="checkbox-label"><input type="checkbox" name="customer" defaultChecked={partner ? Boolean(partner.is_customer) : true} /> 得意先（見積・納品・請求の宛先）</label><label className="checkbox-label"><input type="checkbox" name="supplier" defaultChecked={Boolean(partner?.is_supplier)} /> 仕入先（発注書の宛先）</label></fieldset>
        <label className="field full"><span>メモ</span><textarea name="notes" rows={2} maxLength={2000} defaultValue={partner?.notes} /></label></> : <>
        <label className="field"><span>商品コード <b>*</b></span><input name="code" required maxLength={40} defaultValue={product?.code} /></label><label className="field"><span>品名 <b>*</b></span><input name="name" required maxLength={200} defaultValue={product?.name} /></label>
        <label className="field full"><span>説明</span><input name="description" maxLength={300} defaultValue={product?.description} /></label>
        <label className="field"><span>単位 <b>*</b></span><input name="unit" defaultValue={product?.unit ?? "個"} required maxLength={20} /></label><label className="field"><span>標準単価（円） <b>*</b></span><input name="price" inputMode="decimal" defaultValue={product?.unit_price_decimal ?? "0"} required pattern="(0|[1-9][0-9]*)(\.[0-9]{1,4})?" title="0以上の数値（小数点以下4桁まで）" /></label>
        <label className="field"><span>税区分</span><select name="taxClass" defaultValue={product?.tax_class ?? "STANDARD_10"}>{taxOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}</div>
        <div className="editor-bottom-actions">{editing !== "new" && <button type="button" className="text-button danger" onClick={() => void archive(editing)}>この{counterparty ? "取引先" : "商品"}を削除</button>}<span className="spacer" /><button type="button" className="button secondary" onClick={() => setEditing(null)}>キャンセル</button><button className="button primary">{editing === "new" ? "登録する" : "変更を保存"}</button></div></form></section>}
    <div className="list-toolbar"><div className="search-field"><span>⌕</span><input placeholder={counterparty ? "会社名で検索" : "品名・商品コードで検索"} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void load(query); }} /><button className="text-button" onClick={() => void load(query)}>検索</button></div><span className="master-count">{rows.length} 件</span></div>
    {error && <div role="alert" className="inline-alert">{error}<button className="text-button" onClick={() => setError("")}>　×</button></div>}{saved && <div className="inline-success">{saved}</div>}
    <section className="panel documents-panel">{rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr>{counterparty ? <><th>会社名</th><th>取引区分</th><th>住所</th><th>電話番号</th></> : <><th>商品コード</th><th>品名</th><th>単位</th><th className="right">標準単価</th><th>税区分</th></>}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => { setEditing(row); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{counterparty ? (() => { const item = row as Counterparty; return <><td><strong>{item.name}</strong></td><td>{[item.is_customer ? "得意先" : "", item.is_supplier ? "仕入先" : ""].filter(Boolean).join("・")}</td><td>{[item.prefecture, item.address, item.building].filter(Boolean).join("") || "—"}</td><td>{item.phone || "—"}</td></>; })() : (() => { const item = row as Product; return <><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.unit}</td><td className="amount-cell right">¥{new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(Number(item.unit_price_decimal))}</td><td>{taxLabels[item.tax_class as TaxClass] ?? item.tax_class}</td></>; })()}<td className="row-arrow">編集</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-document">◇</span><strong>{activeQuery ? "該当するデータがありません" : counterparty ? "取引先を登録してください" : "商品・サービスを登録してください"}</strong><p>情報を登録すると、帳票作成時に再利用できます。</p><button className="button secondary" onClick={() => setEditing("new")}>＋ {counterparty ? "取引先を追加" : "商品を追加"}</button></div>}</section>{nextCursor && <button className="button secondary" disabled={busy} onClick={() => void load(activeQuery, nextCursor)}>{busy ? "読み込み中…" : "さらに表示"}</button>}</>;
}
