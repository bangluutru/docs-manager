import { calculateDocumentTax, type TaxCalculation, type TaxLineInput, type TaxSettings } from "../domain/tax";
import { bankAccountTypeLabels, DEFAULT_BANK_NOTE, documentTitles, formatJaDate, paymentMethodLabels, recipientLine, type BankAccount, type DocumentType, type DraftDocument } from "../domain/document";
import { formatYen } from "../domain/money";

export const RENDERER_VERSION = "jds-2";

export interface IssuerSnapshot {
  legalName: string;
  postalCode?: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  representative?: string;
  registrationNumber?: string;
  qualifiedMode?: boolean;
}

export interface DocumentViewModel {
  id: string;
  number: string;
  revision: number;
  status: string;
  data: DraftDocument;
  issuer: IssuerSnapshot;
  theme: "standard" | "modern";
  accentColor: string;
  tax: TaxSettings;
  bank?: Partial<BankAccount>;
  /** Image sources for the company seal and logo: API URLs in the live preview, data URLs in the PDF. */
  assets?: { sealUrl?: string; logoUrl?: string };
  titles?: Partial<Record<DocumentType, string>>;
}

export interface RenderOptions {
  /** Stylesheet URL providing Noto Sans/Serif JP when the rendering browser may lack them. */
  fontStylesheet?: string;
}

export const PDF_FONT_STYLESHEET = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Serif+JP:wght@500;600&display=block";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));
const e = (value: string | number | null | undefined) => escapeHtml(String(value ?? ""));

export function calculateViewModel(data: DraftDocument, settings: TaxSettings) {
  return calculateDocumentTax(data.lines as TaxLineInput[], settings);
}

/** "1234.5" → "1,234.5": groups the integer part and keeps the decimals as entered. */
function formatDecimal(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = /^\d+$/.test(integer) ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integer;
  return fraction ? `${grouped}.${fraction}` : grouped;
}

const LEAD: Record<DocumentType, string> = {
  QT: "下記の通り御見積り申し上げます。",
  DN: "下記の通り納品いたしました。",
  INV: "下記の通りご請求申し上げます。",
  RC: "",
  PO: "下記の通り発注いたします。",
  OC: "下記の通りご注文をお請けいたします。",
};
const AMOUNT_LABEL: Record<DocumentType, string> = {
  QT: "御見積金額", DN: "合計金額", INV: "ご請求金額", RC: "領収金額", PO: "発注金額", OC: "受注確認金額",
};
const NUMBER_LABEL: Record<DocumentType, string> = {
  QT: "見積番号", DN: "納品書番号", INV: "請求番号", RC: "領収番号", PO: "発注番号", OC: "注文請書番号",
};
const DATE_LABEL: Record<DocumentType, string> = {
  QT: "発行日", DN: "発行日", INV: "請求日", RC: "領収日", PO: "発注日", OC: "発行日",
};
const RATE_LABEL = { STANDARD_10: "10%", REDUCED_8: "8%", NON_TAXABLE: "非課税", OUT_OF_SCOPE: "不課税", EXEMPT: "免税" } as const;
// Receipts for cash sales of ¥50,000 or more (before tax) need a revenue stamp when handed over on paper.
const REVENUE_STAMP_THRESHOLD_YEN = 50_000;
const FILLER_ROWS = 6;

function conditionRows(data: DraftDocument): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: string | undefined | null) => { if (value && value.trim()) rows.push([label, value.trim()]); };
  const type = data.type;
  if (type === "QT") add("見積有効期限", formatJaDate(data.validUntil));
  if (type === "INV") {
    add("お支払期限", formatJaDate(data.dueDate));
    if (data.transactionDate) add("取引年月日", formatJaDate(data.transactionDate));
    else if (data.periodStart && data.periodEnd) add("取引期間", `${formatJaDate(data.periodStart)} ～ ${formatJaDate(data.periodEnd)}`);
  }
  if (type === "OC") add("受注日", formatJaDate(data.acceptedDate));
  if (type === "DN") add("納品日", formatJaDate(data.deliveryDate));
  if (type === "OC") add("納期", formatJaDate(data.deliveryDate));
  if (type === "PO") add("希望納期", formatJaDate(data.requestedDeliveryDate));
  if (type === "QT") add("納期", data.deliveryTerms);
  if (type !== "INV" && type !== "RC") add("納品場所", data.deliveryPlace);
  if (type === "QT" || type === "PO" || type === "OC") add("支払条件", data.paymentTerms);
  if (type === "DN" || type === "OC") add("ご注文番号", data.purchaseOrderNumber);
  if (type === "PO" || type === "INV") add("見積番号", data.quotationReference);
  if (type === "RC") add("お支払方法", paymentMethodLabels[data.paymentMethod]);
  return rows;
}

function styles(view: DocumentViewModel): string {
  const modern = view.theme === "modern";
  const accent = modern && /^#[0-9A-Fa-f]{6}$/.test(view.accentColor) ? view.accentColor : "#1f2428";
  const gothic = `"Noto Sans JP","Noto Sans CJK JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
  const mincho = `"Noto Serif JP","Noto Serif CJK JP","Hiragino Mincho ProN","Yu Mincho","YuMincho","MS PMincho",serif`;
  return `
    @page { size: A4 portrait; margin: 16mm 16mm 17mm; }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; color:#1f2428; font-family:${gothic}; font-size:9pt; line-height:1.55; font-feature-settings:"tnum"; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { background:#e9edf0; }
    .sheet { width:210mm; min-height:297mm; margin:0 auto 16px; padding:16mm 16mm 17mm; background:#fff; position:relative; display:flex; flex-direction:column; }
    .title-block { text-align:${modern ? "left" : "center"}; margin-bottom:${modern ? "5.5mm" : "6mm"}; ${modern ? `border-top:1.2mm solid ${accent}; padding-top:5mm;` : ""} }
    h1 { display:inline-block; margin:0; font-family:${modern ? gothic : mincho}; font-size:${modern ? "21pt" : "22pt"}; line-height:1.25; font-weight:${modern ? 500 : 600}; letter-spacing:${modern ? ".22em" : ".5em"}; margin-right:${modern ? "-.22em" : "-.5em"}; color:${accent};
      ${modern ? "" : "padding:0 9mm 1.6mm; border-bottom:.8mm double #1f2428;"} }
    .parties { display:flex; justify-content:space-between; align-items:flex-start; gap:8mm; }
    .party-left { flex:1 1 0; min-width:0; }
    .party-right { flex:0 0 68mm; font-size:8.5pt; line-height:1.6; color:#33393e; }
    .recipient-address { font-size:8.5pt; line-height:1.55; color:#444b51; margin-bottom:1.6mm; }
    .recipient-name { font-size:13.5pt; line-height:1.55; font-weight:500; padding-bottom:1.4mm; border-bottom:.35mm solid #1f2428; overflow-wrap:anywhere; }
    .recipient-name .sub { font-size:11pt; }
    .recipient-empty { color:#a9afb4; font-size:10pt; font-weight:400; }
    .lead { margin:4mm 0 0; font-size:9pt; color:#33393e; }
    .subject { margin-top:4mm; display:flex; gap:3mm; font-size:10pt; padding-bottom:1.2mm; border-bottom:.2mm solid #8d949a; }
    .subject span { flex:none; color:#555d63; font-size:8.5pt; padding-top:.4mm; }
    .subject strong { font-weight:500; overflow-wrap:anywhere; }
    .amount { margin-top:4mm; display:flex; align-items:baseline; justify-content:space-between; gap:4mm; padding:2.6mm 4mm 2.4mm; background:${modern ? "#fff" : "#f3f4f5"}; border-top:.5mm solid ${accent}; border-bottom:.5mm solid ${accent}; }
    .amount span { font-size:9.5pt; font-weight:500; color:#33393e; white-space:nowrap; }
    .amount strong { font-size:20pt; line-height:1.2; font-weight:700; letter-spacing:.01em; color:${accent}; white-space:nowrap; }
    .amount small { font-size:8.5pt; font-weight:400; color:#555d63; margin-left:1.5mm; }
    .meta { width:100%; border-collapse:collapse; margin:0 0 4mm; }
    .meta th, .meta td { border:0; padding:.3mm 0; font-size:8.5pt; line-height:1.6; vertical-align:top; background:none; }
    .meta th { width:23mm; text-align:left; font-weight:400; color:#555d63; }
    .meta td { text-align:right; }
    .issuer { min-height:22mm; }
    .logo { display:block; max-width:32mm; max-height:16mm; margin-bottom:2mm; object-fit:contain; }
    .issuer-name { font-size:11pt; font-weight:700; line-height:1.5; color:#1f2428; margin-bottom:.8mm; overflow-wrap:anywhere; }
    .issuer div { overflow-wrap:anywhere; }
    .seal { float:right; width:20mm; height:20mm; margin:-1mm 0 .5mm 2mm; object-fit:contain; opacity:.9; }
    .issuer::after { content:""; display:block; clear:both; }
    .registration { margin-top:.8mm; }
    .conditions { width:100%; border-collapse:collapse; margin-top:4.5mm; table-layout:fixed; }
    .conditions th, .conditions td { border:.2mm solid ${modern ? "#d5d9dc" : "#9aa0a5"}; padding:1.3mm 2.4mm; font-size:8.5pt; vertical-align:top; text-align:left; }
    .conditions th { width:24mm; font-weight:500; color:#33393e; background:#f3f4f5; white-space:nowrap; }
    .conditions td { overflow-wrap:anywhere; }
    ${modern ? ".conditions th, .conditions td { border-left:0; border-right:0; } .conditions th { background:none; color:#555d63; }" : ""}
    .items { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:4.5mm; }
    .items thead { display:table-header-group; }
    .items th { font-size:8pt; font-weight:500; text-align:center; color:#1f2428; padding:1.7mm 1.5mm; white-space:nowrap; }
    .items td { padding:1.45mm 1.8mm; vertical-align:top; height:6.5mm; }
    .items tbody tr { break-inside:avoid; page-break-inside:avoid; }
    ${modern
      ? `.items th { border-top:.2mm solid ${accent}; border-bottom:.5mm solid ${accent}; color:${accent}; } .items td { border-bottom:.2mm solid #d5d9dc; }`
      : `.items th { background:#eceeef; border:.2mm solid #7b8288; } .items td { border:.2mm solid #9aa0a5; } .items { border:.35mm solid #4a5157; }`}
    .row-number { text-align:center; color:#555d63; }
    .description { overflow-wrap:anywhere; text-align:left; }
    .number,.money { text-align:right; white-space:nowrap; }
    .unit,.tax { text-align:center; white-space:nowrap; }
    .tax { font-size:8pt; color:#33393e; }
    .after-items { display:flex; justify-content:space-between; align-items:flex-start; gap:8mm; margin-top:3.5mm; break-inside:avoid; page-break-inside:avoid; }
    .breakdown { flex:1 1 0; min-width:0; max-width:92mm; }
    .breakdown table { width:100%; border-collapse:collapse; }
    .breakdown caption { caption-side:top; text-align:left; font-size:8pt; font-weight:500; color:#33393e; padding-bottom:1mm; }
    .breakdown th, .breakdown td { border:.2mm solid ${modern ? "#d5d9dc" : "#9aa0a5"}; padding:1.2mm 2mm; font-size:8pt; }
    .breakdown th { font-weight:500; background:#f3f4f5; text-align:center; }
    .breakdown td { text-align:right; white-space:nowrap; }
    .breakdown td:first-child { text-align:left; }
    .legend { margin:1.4mm 0 0; font-size:7.5pt; color:#555d63; }
    .summary { flex:0 0 72mm; border-collapse:collapse; }
    .summary th, .summary td { padding:1.3mm 2.4mm; font-size:9pt; border-bottom:.2mm solid ${modern ? "#d5d9dc" : "#9aa0a5"}; }
    .summary th { text-align:left; font-weight:400; color:#33393e; }
    .summary td { text-align:right; white-space:nowrap; }
    .summary .grand-total th, .summary .grand-total td { border-top:.4mm solid ${accent}; border-bottom:.4mm solid ${accent}; font-weight:700; color:#1f2428; ${modern ? "" : "background:#f3f4f5;"} }
    .summary .grand-total td { font-size:12.5pt; }
    .summary .inner-tax th, .summary .inner-tax td { font-size:8pt; color:#555d63; }
    .box { margin-top:3.5mm; break-inside:avoid; page-break-inside:avoid; }
    .box h2 { margin:0 0 1.2mm; font-size:8.5pt; font-weight:500; color:#33393e; }
    .box-body { border:.2mm solid ${modern ? "#d5d9dc" : "#9aa0a5"}; padding:1.8mm 3mm; font-size:8.5pt; line-height:1.65; }
    .notes { white-space:pre-wrap; overflow-wrap:anywhere; min-height:11mm; }
    .bank-line { display:flex; flex-wrap:wrap; gap:0 5mm; font-size:9.5pt; font-weight:500; }
    .bank-holder { font-size:9pt; }
    .bank-note { margin-top:.8mm; font-size:7.5pt; color:#555d63; }
    .receipt-statement { margin-top:5mm; display:flex; justify-content:space-between; align-items:flex-start; gap:8mm; }
    .receipt-statement p { margin:0 0 1.5mm; font-size:10.5pt; }
    .receipt-statement .proviso { padding-bottom:1.2mm; border-bottom:.2mm solid #8d949a; min-width:95mm; overflow-wrap:anywhere; }
    .revenue-stamp { flex:none; width:22mm; height:26mm; border:.2mm dashed #8d949a; display:flex; align-items:center; justify-content:center; text-align:center; font-size:7.5pt; line-height:1.5; color:#8d949a; }
    .spacer { flex:1 1 auto; }
    .screen-footer { margin-top:6mm; border-top:.2mm solid #c9cdd1; padding-top:1.6mm; display:flex; justify-content:space-between; color:#7a8187; font-size:7pt; }
    @media screen { .sheet { box-shadow:0 2px 10px #18212a1a; } }
    @media print { body { background:#fff; } .sheet { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; display:block; } .screen-footer, .spacer { display:none; } }
  `;
}

function itemsTable(view: DocumentViewModel, totals: TaxCalculation, showAmount: boolean): string {
  const { data } = view;
  const columnCount = showAmount ? 7 : 4;
  const rows = data.lines.map((line, index) => `<tr><td class="row-number">${index + 1}</td><td class="description">${e(line.description)}</td><td class="number">${e(formatDecimal(line.quantity))}</td><td class="unit">${e(line.unit)}</td>${showAmount
    ? `<td class="money">${e(formatDecimal(line.unitPrice))}</td><td class="tax">${RATE_LABEL[line.taxClass]}${line.taxClass === "REDUCED_8" ? "※" : ""}</td><td class="money">${e(formatYen(totals.lines[index].amountYen))}</td>` : ""}</tr>`);
  if (view.theme !== "modern") for (let i = data.lines.length; i < FILLER_ROWS; i += 1) rows.push(`<tr class="filler">${"<td></td>".repeat(columnCount)}</tr>`);
  const columns = showAmount
    ? `<colgroup><col style="width:8mm"><col><col style="width:16mm"><col style="width:13mm"><col style="width:24mm"><col style="width:14mm"><col style="width:28mm"></colgroup>`
    : `<colgroup><col style="width:10mm"><col><col style="width:24mm"><col style="width:20mm"></colgroup>`;
  const head = `<tr><th>No.</th><th>品名・内容</th><th>数量</th><th>単位</th>${showAmount ? `<th>単価</th><th>税率</th><th>金額</th>` : ""}</tr>`;
  return `<table class="items">${columns}<thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

function totalsBlock(view: DocumentViewModel, totals: TaxCalculation): string {
  const { data } = view;
  const inclusive = data.taxMode === "inclusive";
  const hasReduced = totals.groups.some((group) => group.taxClass === "REDUCED_8");
  const breakdownRows = totals.groups.map((group) => {
    const label = group.rate ? `${group.rate}%対象${group.taxClass === "REDUCED_8" ? " ※" : ""}` : RATE_LABEL[group.taxClass];
    return `<tr><td>${label}</td><td>${e(formatYen(inclusive ? group.grossYen : group.netYen))}</td><td>${group.rate ? e(formatYen(group.taxYen)) : "—"}</td></tr>`;
  }).join("");
  const breakdown = `<div class="breakdown"><table><caption>税率別内訳</caption><thead><tr><th>税率区分</th><th>${inclusive ? "対象金額（税込）" : "対象金額（税抜）"}</th><th>${inclusive ? "内消費税額" : "消費税額"}</th></tr></thead><tbody>${breakdownRows}</tbody></table>${hasReduced ? `<p class="legend">※印は軽減税率（8%）対象品目です。</p>` : ""}</div>`;
  const taxRows = totals.groups.filter((group) => group.rate).map((group) => inclusive
    ? `<tr class="inner-tax"><th>内消費税（${group.rate}%）</th><td>${e(formatYen(group.taxYen))}</td></tr>`
    : `<tr><th>消費税（${group.rate}%）</th><td>${e(formatYen(group.taxYen))}</td></tr>`).join("");
  const summary = inclusive
    ? `<table class="summary" aria-label="合計"><tbody><tr class="grand-total"><th>合計（税込）</th><td>${e(formatYen(totals.totalYen))}</td></tr>${taxRows}</tbody></table>`
    : `<table class="summary" aria-label="合計"><tbody><tr><th>小計（税抜）</th><td>${e(formatYen(totals.subtotalYen))}</td></tr>${taxRows}<tr class="grand-total"><th>合計（税込）</th><td>${e(formatYen(totals.totalYen))}</td></tr></tbody></table>`;
  return `<section class="after-items">${breakdown}${summary}</section>`;
}

function bankBlock(view: DocumentViewModel): string {
  const bank = view.bank;
  if (view.data.type !== "INV" || !bank?.bankName?.trim() || !bank.accountNumber?.trim()) return "";
  return `<section class="box bank"><h2>お振込先</h2><div class="box-body"><div class="bank-line"><span>${e(bank.bankName)}${bank.branchName ? `　${e(bank.branchName)}` : ""}</span><span>${e(bankAccountTypeLabels[bank.accountType ?? "ORDINARY"])}　${e(bank.accountNumber)}</span>${bank.accountHolder ? `<span class="bank-holder">口座名義：${e(bank.accountHolder)}</span>` : ""}</div><div class="bank-note">${e(bank.note?.trim() || DEFAULT_BANK_NOTE)}</div></div></section>`;
}

export function renderDocumentHtml(view: DocumentViewModel, options: RenderOptions = {}): string {
  const { data, issuer } = view;
  const totals = calculateViewModel(data, view.tax);
  const type = data.type;
  const receipt = type === "RC";
  const showAmount = type !== "DN" || data.showAmounts;
  const title = view.titles?.[type]?.trim() || documentTitles[type];
  const revisionLabel = view.revision > 0 ? `（改訂${view.revision}）` : "";
  const numberLabel = view.number ? `${view.number}${revisionLabel}` : "下書き・未採番";

  const nameLines = recipientLine(data);
  const recipientAddress = [data.recipientPostalCode ? `〒${data.recipientPostalCode}` : "", data.recipientAddress, data.recipientBuilding].filter((line) => line && line.trim());
  const recipient = `${recipientAddress.length ? `<div class="recipient-address">${recipientAddress.map((line) => `<div>${e(line)}</div>`).join("")}</div>` : ""}
      <div class="recipient-name">${nameLines.length ? nameLines.map((line, index) => `<div${index > 0 && nameLines.length > 2 && index < nameLines.length - 1 ? ' class="sub"' : ""}>${e(line)}</div>`).join("") : '<span class="recipient-empty">宛名</span>'}</div>`;

  const meta = `<table class="meta"><tbody><tr><th>${NUMBER_LABEL[type]}</th><td>${e(numberLabel)}</td></tr><tr><th>${DATE_LABEL[type]}</th><td>${e(formatJaDate(data.issueDate))}</td></tr></tbody></table>`;
  const contact = [issuer.phone ? `TEL ${issuer.phone}` : "", issuer.fax ? `FAX ${issuer.fax}` : ""].filter(Boolean).join("　");
  const issuerBlock = `<div class="issuer">
      ${view.assets?.logoUrl ? `<img class="logo" src="${e(view.assets.logoUrl)}" alt="">` : ""}
      ${view.assets?.sealUrl ? `<img class="seal" src="${e(view.assets.sealUrl)}" alt="">` : ""}
      <div class="issuer-name">${e(issuer.legalName)}</div>
      ${issuer.representative ? `<div>${e(issuer.representative)}</div>` : ""}
      ${issuer.postalCode ? `<div>〒${e(issuer.postalCode)}</div>` : ""}
      ${issuer.address ? `<div>${e(issuer.address)}</div>` : ""}
      ${contact ? `<div>${e(contact)}</div>` : ""}
      ${issuer.email ? `<div>${e(issuer.email)}</div>` : ""}
      ${issuer.registrationNumber ? `<div class="registration">登録番号：${e(issuer.registrationNumber)}</div>` : ""}
    </div>`;

  const amount = showAmount ? `<div class="amount"><span>${AMOUNT_LABEL[type]}</span><strong>${e(formatYen(totals.totalYen))}${receipt ? "－" : ""}<small>（税込）</small></strong></div>` : "";
  const conditions = conditionRows(data);
  const pairs: string[] = [];
  for (let i = 0; i < conditions.length; i += 2) {
    const [first, second] = [conditions[i], conditions[i + 1]];
    pairs.push(`<tr><th>${e(first[0])}</th><td${second ? "" : ' colspan="3"'}>${e(first[1])}</td>${second ? `<th>${e(second[0])}</th><td>${e(second[1])}</td>` : ""}</tr>`);
  }
  const conditionsTable = pairs.length ? `<table class="conditions"><tbody>${pairs.join("")}</tbody></table>` : "";
  const needsStamp = receipt && data.paymentMethod === "CASH" && totals.subtotalYen >= REVENUE_STAMP_THRESHOLD_YEN;
  const receiptStatement = receipt ? `<section class="receipt-statement"><div><p class="proviso">但し、${e(data.purpose || "")}</p><p>上記正に領収いたしました。</p></div>${needsStamp ? `<div class="revenue-stamp">収入印紙</div>` : ""}</section>` : "";

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}${view.number ? ` ${e(view.number)}` : ""}</title>
  ${options.fontStylesheet ? `<link rel="stylesheet" href="${e(options.fontStylesheet)}">` : ""}
  <style>${styles(view)}</style></head><body><main class="sheet theme-${view.theme === "modern" ? "modern" : "standard"} type-${type}" data-jds-sheet="1">
    <div class="title-block"><h1>${e(title)}</h1></div>
    <section class="parties">
      <div class="party-left">${recipient}
        ${LEAD[type] ? `<p class="lead">${LEAD[type]}</p>` : ""}
        ${data.subject ? `<div class="subject"><span>件名</span><strong>${e(data.subject)}</strong></div>` : ""}
        ${amount}
      </div>
      <div class="party-right">${meta}${issuerBlock}</div>
    </section>
    ${receiptStatement}
    ${conditionsTable}
    ${itemsTable(view, totals, showAmount)}
    ${showAmount ? totalsBlock(view, totals) : ""}
    ${bankBlock(view)}
    <section class="box"><h2>備考</h2><div class="box-body notes">${e(data.notes || "")}</div></section>
    <div class="spacer"></div>
    <footer class="screen-footer"><span>${e(issuer.legalName)}</span><span>${e(numberLabel)}</span></footer>
  </main></body></html>`;
}

export function renderDocumentPreview(view: DocumentViewModel, fallbackHtml: string): { html: string; stale: boolean } {
  try { return { html: renderDocumentHtml(view), stale: false }; }
  catch { return { html: fallbackHtml, stale: true }; }
}

/**
 * Options for Chromium's page.pdf(). The running footer (document number and page N / M) is drawn by
 * the browser in the bottom page margin, which works on every Chromium version the PDF service may run.
 */
export function pdfOptions(view: Pick<DocumentViewModel, "number" | "revision">) {
  const label = `${(view.number || "DRAFT").replace(/[^A-Za-z0-9_-]/g, "")}${view.revision > 0 ? ` rev.${view.revision}` : ""}`;
  return {
    format: "A4" as const, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;padding:0 16mm 2mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#7a8187;"><span>${label}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  };
}
