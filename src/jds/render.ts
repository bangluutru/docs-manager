import { calculateDocumentTax, type TaxLineInput, type TaxSettings } from "../domain/tax";
import { documentTitles, recipientLine, taxLabels, type DraftDocument } from "../domain/document";
import { formatYen } from "../domain/money";

export interface IssuerSnapshot {
  legalName: string;
  postalCode?: string;
  address?: string;
  phone?: string;
  representative?: string;
  registrationNumber?: string;
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
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

export function calculateViewModel(data: DraftDocument, settings: TaxSettings) {
  return calculateDocumentTax(data.lines as TaxLineInput[], settings);
}

export function renderDocumentHtml(view: DocumentViewModel): string {
  const { data, issuer } = view;
  const totals = calculateViewModel(data, view.tax);
  const recipient = recipientLine(data).map((line) => `<div>${escapeHtml(line)}</div>`).join("")+
    `${data.recipientPostalCode?`<div class="recipient-address">〒${escapeHtml(data.recipientPostalCode)}</div>`:""}${data.recipientAddress?`<div class="recipient-address">${escapeHtml(data.recipientAddress)}</div>`:""}${data.recipientBuilding?`<div class="recipient-address">${escapeHtml(data.recipientBuilding)}</div>`:""}`;
  const modern = view.theme === "modern";
  const delivery = data.type === "DN";
  const showAmount = !delivery || data.showAmounts;
  const title = documentTitles[data.type];
  const lineRows = data.lines.map((line, index) => {
    const amount = totals.lines[index].amountYen;
    return `<tr><td class="row-number">${index + 1}</td><td class="description">${escapeHtml(line.description)}</td><td class="number">${escapeHtml(line.quantity)}</td><td class="unit">${escapeHtml(line.unit)}</td>${showAmount ? `${!delivery ? `<td class="tax">${escapeHtml(taxLabels[line.taxClass])}</td>` : ""}<td class="money">${escapeHtml(formatYen(amount))}</td>` : ""}</tr>`;
  }).join("");
  const columns = delivery
    ? showAmount ? `<colgroup><col style="width:8%"><col style="width:auto"><col style="width:12%"><col style="width:9%"><col style="width:19%"></colgroup>` : `<colgroup><col style="width:8%"><col style="width:auto"><col style="width:14%"><col style="width:12%"></colgroup>`
    : `<colgroup><col style="width:8%"><col style="width:auto"><col style="width:12%"><col style="width:9%"><col style="width:14%"><col style="width:19%"></colgroup>`;
  const subtotal = data.taxMode === "inclusive" ? totals.subtotalYen : totals.lines.reduce((sum, line) => sum + line.amountYen, 0);
  const summary = showAmount ? `<section class="summary" aria-label="合計">
      <div><span>小計</span><strong>${escapeHtml(formatYen(subtotal))}</strong></div>
      ${totals.groups.map((group) => `<div><span>${escapeHtml(taxLabels[group.taxClass])} 消費税</span><strong>${escapeHtml(formatYen(group.taxYen))}</strong></div>`).join("")}
      <div class="grand-total"><span>合計</span><strong>${escapeHtml(formatYen(totals.totalYen))}</strong></div>
    </section>` : "";

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; color:#252a2e; font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif; font-size:9pt; line-height:1.55; font-feature-settings:"tnum"; }
    body { background:#e9edf0; }
    .sheet { width:210mm; min-height:297mm; margin:0 auto 16px; padding:17mm; background:#fff; position:relative; }
    .topline { height:1px; background:${modern ? escapeHtml(view.accentColor) : "#92999e"}; margin-bottom:7mm; }
    .title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10mm; }
    h1 { color:${modern ? escapeHtml(view.accentColor) : "#222"}; font-size:22pt; line-height:1.2; font-weight:500; letter-spacing:.08em; margin:0 0 7mm; }
    .meta { text-align:right; font-size:8.5pt; color:#555e64; line-height:1.8; }
    .recipient { min-height:25mm; font-size:13pt; line-height:1.8; font-weight:500; }
    .recipient-address { font-size:8.5pt; line-height:1.55; font-weight:400; color:#50585e; }
    .issuer { margin-top:3mm; margin-left:auto; text-align:right; font-size:8.5pt; color:#43494d; line-height:1.65; }
    .issuer strong { font-size:10pt; color:#252a2e; }
    .subject { border-top:1px solid #aab0b4; border-bottom:1px solid #aab0b4; padding:2mm 0; margin:6mm 0 5mm; font-size:10pt; }
    .amount { display:flex; justify-content:space-between; align-items:baseline; margin:4mm 0 7mm; padding:2mm 0 3mm; border-bottom:1px solid ${modern ? escapeHtml(view.accentColor) : "#50575b"}; }
    .amount span { font-size:9pt; color:#596168; }
    .amount strong { font-size:20pt; font-weight:700; letter-spacing:.01em; color:${modern ? escapeHtml(view.accentColor) : "#222"}; }
    .recipient-empty { color:#aaa; font-size:10pt; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:5mm; }
    thead { display:table-header-group; }
    th { font-size:8pt; font-weight:500; text-align:left; color:#50575b; border-bottom:1px solid #777f84; padding:2mm 1.4mm; }
    td { border-bottom:1px solid #d7dadd; padding:2.2mm 1.4mm; vertical-align:top; }
    tbody tr { break-inside:avoid; page-break-inside:avoid; }
    .row-number { color:#737b80; width:8%; text-align:center; }
    .description { overflow-wrap:anywhere; }
    .number,.unit,.money,.tax { text-align:right; white-space:nowrap; }
    .unit { color:#5a6267; }
    .tax { font-size:7.5pt; color:#596168; }
    .summary { width:76mm; margin:5mm 0 0 auto; break-inside:avoid; }
    .summary div { display:flex; justify-content:space-between; padding:1.1mm 0; }
    .summary span { color:#545c61; }
    .summary strong { font-weight:500; }
    .summary .grand-total { margin-top:2mm; padding-top:2mm; border-top:1px solid #70787d; font-size:11pt; }
    .summary .grand-total strong { font-size:14pt; font-weight:700; }
    .conditions { margin-top:8mm; break-inside:avoid; }
    .conditions h2 { font-size:9pt; font-weight:500; border-bottom:1px solid #aab0b4; padding-bottom:1.5mm; margin:0 0 2mm; }
    .notes { white-space:pre-wrap; overflow-wrap:anywhere; min-height:8mm; font-size:8pt; }
    .footer { position:absolute; bottom:10mm; left:17mm; right:17mm; border-top:1px solid #c2c6c9; padding-top:2mm; display:flex; justify-content:space-between; color:#697176; font-size:7.5pt; }
    @media screen { .sheet { box-shadow:0 2px 10px #18212a1a; } }
    @media print { body { background:#fff; } .sheet { margin:0; box-shadow:none; break-after:page; } .sheet:last-child { break-after:auto; } }
  </style></head><body><main class="sheet" data-jds-sheet="1">
    <div class="topline"></div>
    <div class="title-row"><h1>${escapeHtml(title)}</h1><div class="meta"><div>${escapeHtml(view.number || "下書き・未採番")}${view.revision > 0 ? ` 改訂${view.revision}` : ""}</div><div>${escapeHtml(data.issueDate)}</div></div></div>
    <div class="recipient">${recipient || '<span class="recipient-empty">宛名</span>'}</div>
    <div class="issuer"><strong>${escapeHtml(issuer.legalName)}</strong>${issuer.postalCode ? `<div>〒${escapeHtml(issuer.postalCode)}</div>` : ""}${issuer.address ? `<div>${escapeHtml(issuer.address)}</div>` : ""}${issuer.representative ? `<div>${escapeHtml(issuer.representative)}</div>` : ""}${issuer.registrationNumber ? `<div>${escapeHtml(issuer.registrationNumber)}</div>` : ""}</div>
    ${data.subject ? `<div class="subject">件名：${escapeHtml(data.subject)}</div>` : ""}
    ${!delivery ? `<div class="amount"><span>${data.type === "QT" ? "御見積金額" : data.type === "PO" ? "発注金額" : data.type === "OC" ? "受注確認金額" : data.type === "RC" ? "領収金額" : "ご請求金額"}</span><strong>${escapeHtml(formatYen(totals.totalYen))}－</strong></div>` : ""}
    <table>${columns}<thead><tr><th>№</th><th>品名・内容</th><th class="number">数量</th><th class="unit">単位</th>${showAmount ? `${!delivery ? '<th class="tax">税区分</th>' : ""}<th class="money">金額</th>` : ""}</tr></thead><tbody>${lineRows}</tbody></table>
    ${summary}
    <section class="conditions"><h2>備考</h2><div class="notes">${escapeHtml(data.notes || "")}</div></section>
    ${data.validUntil ? `<section class="conditions"><h2>見積有効期限</h2><div>${escapeHtml(data.validUntil)}</div></section>` : ""}
    ${data.type === "OC" && data.acceptedDate ? `<section class="conditions"><h2>受注日</h2><div>${escapeHtml(data.acceptedDate)}</div></section>` : ""}
    ${data.dueDate && data.type === "INV" ? `<section class="conditions"><h2>お支払期限</h2><div>${escapeHtml(data.dueDate)}</div></section>` : ""}
    ${data.type === "INV" && (data.transactionDate || (data.periodStart && data.periodEnd)) ? `<section class="conditions"><h2>${data.transactionDate ? "取引年月日" : "取引期間"}</h2><div>${data.transactionDate ? escapeHtml(data.transactionDate) : `${escapeHtml(data.periodStart!)} ～ ${escapeHtml(data.periodEnd!)}`}</div></section>` : ""}
    ${data.deliveryDate || data.requestedDeliveryDate ? `<section class="conditions"><h2>${data.type === "PO" ? "希望納期" : "納期"}</h2><div>${escapeHtml(data.deliveryDate || data.requestedDeliveryDate || "")}</div></section>` : ""}
    ${data.deliveryPlace ? `<section class="conditions"><h2>納品場所</h2><div>${escapeHtml(data.deliveryPlace)}</div></section>` : ""}
    ${data.paymentTerms ? `<section class="conditions"><h2>支払条件</h2><div>${escapeHtml(data.paymentTerms)}</div></section>` : ""}
    ${data.purchaseOrderNumber ? `<section class="conditions"><h2>注文番号</h2><div>${escapeHtml(data.purchaseOrderNumber)}</div></section>` : ""}
    ${data.quotationReference ? `<section class="conditions"><h2>見積番号</h2><div>${escapeHtml(data.quotationReference)}</div></section>` : ""}
    ${data.type === "RC" && data.purpose ? `<section class="conditions"><h2>但し書き</h2><div>但し、${escapeHtml(data.purpose)}</div><div style="margin-top:4mm">上記正に領収いたしました。</div></section>` : ""}
    ${data.type === "RC" ? `<section class="conditions"><h2>お支払方法</h2><div>${data.paymentMethod === "CASH" ? "現金" : data.paymentMethod === "BANK_TRANSFER" ? "銀行振込" : data.paymentMethod === "CARD" ? "カード" : "その他"}</div></section>` : ""}
    <footer class="footer"><span>${escapeHtml(issuer.legalName)}</span><span>${escapeHtml(view.number || "下書き")}${view.revision > 0 ? `・改訂${view.revision}` : ""}</span></footer>
  </main></body></html>`;
}

export function renderDocumentPreview(view: DocumentViewModel, fallbackHtml: string): { html: string; stale: boolean } {
  try { return { html: renderDocumentHtml(view), stale: false }; }
  catch { return { html: fallbackHtml, stale: true }; }
}
