import type { BankAccount, DocumentDefaults, DraftDocument, DocumentType } from "../domain/document";
import type { DocumentViewModel } from "../jds/render";

export interface DocumentSummary {
  id: string; type: DocumentType; number: string | null; revision: number; state: string;
  subject: string; issue_date: string; due_date: string | null; total_yen: number; recipient_search_name: string;
  counterparty_id:string|null;has_correction:number;paid_yen:number;payment_status:string|null;overdue:number;
}
export interface DocumentFilters {from:string;to:string;minAmount:string;maxAmount:string;counterpartyId:string;status:string}
export interface PaymentEntry {
  id:string;payment_date:string;amount_yen:number;method:"BANK_TRANSFER"|"CASH"|"CARD"|"OTHER";note:string;created_at:string;
  voided_at:string|null;correction_reason:string|null;replaces_payment_id:string|null;
}
export interface PaymentSummary {totalYen:number;paidYen:number;outstandingYen:number;status:"UNPAID"|"PARTIALLY_PAID"|"PAID";payments:PaymentEntry[]}
export interface RevisionSummary {id:string;revision:number;state:string;issue_date:string;subject:string;total_yen:number;issued_at:string|null;created_at:string;previous_revision_id:string|null;reason:string|null}
export interface Organization {
  id: string; legal_name: string; display_name: string; postal_code: string; prefecture: string;
  address: string; building: string; phone: string; representative: string; default_tax_mode: "exclusive"|"inclusive";
  tax_rounding: "floor"|"half-up"|"ceil"; line_rounding: "floor"|"half-up"|"ceil";
  theme: "standard"|"modern"; accent_color: string; qualified_mode: number; registration_number: string | null;
  fax: string; email: string; website: string; logo_asset_id: string | null; seal_asset_id: string | null;
  quotation_title: string; purchase_order_title: string; delivery_show_amounts: number;
  bank: BankAccount; defaults: DocumentDefaults; numbering: Record<DocumentType, string>;
}
export type DocumentSnapshot = Pick<DocumentViewModel, "issuer" | "theme" | "accentColor" | "tax" | "bank" | "assets" | "titles">;
export interface DocumentRecord extends DocumentSnapshot { id: string; number: string; revision: number; status: string; version: number; sentAt: string | null; data: DraftDocument }
export interface UserAccount { id: string; email: string; display_name: string; role: "ADMIN" | "MEMBER"; active: number; signed_in: number; created_at: string }
export interface SessionActor { id: string; role: "ADMIN" | "MEMBER"; name: string; email: string }

export interface Page<T> {data:T[];nextCursor:string|null}
export interface Counterparty {id:string;name:string;kana:string;is_customer:number;is_supplier:number;postal_code:string;prefecture:string;address:string;building:string;phone:string;email:string;notes:string}
export interface Product {id:string;code:string;name:string;description:string;unit:string;unit_price_decimal:string;tax_class:string}

async function requestEnvelope<T>(path: string, options?: RequestInit): Promise<{data:T;nextCursor:string|null}> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as { data?: T; nextCursor?: string|null; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "通信に失敗しました。もう一度お試しください。");
  return {data:body.data as T,nextCursor:body.nextCursor??null};
}
async function request<T>(path:string,options?:RequestInit):Promise<T>{return (await requestEnvelope<T>(path,options)).data;}
function pageQuery(cursor?:string):Record<string,string>{return cursor?{cursor}:{};}
const pendingMutationKeys = new Map<string, { fingerprint: string; key: string }>();
async function requestIdempotently<T>(operation: string, path: string, body: unknown, headers:Record<string,string>={}): Promise<T> {
  const serialized = JSON.stringify(body);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `jds:idempotency:${operation}:${fingerprint}`;
  let pending = pendingMutationKeys.get(storageKey);
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { fingerprint?: string; key?: string };
      if (parsed.fingerprint === fingerprint && parsed.key) pending = { fingerprint, key: parsed.key };
    }
  } catch { /* Keep the in-memory retry key when session storage is unavailable. */ }
  if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, key: crypto.randomUUID() };
  pendingMutationKeys.set(storageKey, pending);
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* Memory still covers retries in this page. */ }
  try {
    const result = await request<T>(path, { method: "POST", body: serialized, headers: { "Idempotency-Key": pending.key,...headers } });
    if (pendingMutationKeys.get(storageKey)?.key === pending.key) pendingMutationKeys.delete(storageKey);
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored && (JSON.parse(stored) as { key?: string }).key === pending.key) sessionStorage.removeItem(storageKey);
    } catch { /* The successful response is authoritative even if storage cleanup fails. */ }
    return result;
  } catch (error) {
    // A network failure may have happened after the server committed. Retain
    // this key so an identical retry replays that committed mutation.
    throw error;
  }
}
export const api = {
  getOrganization: () => request<Organization>("/api/v1/organization"),
  session: () => request<{actor:SessionActor}>("/api/v1/session"),
  saveDocumentSettings: (data: object) => request<{ saved: boolean }>("/api/v1/settings/documents", { method: "PUT", body: JSON.stringify(data) }),
  saveBank: (data: BankAccount) => request<{ saved: boolean }>("/api/v1/settings/bank", { method: "PUT", body: JSON.stringify(data) }),
  uploadBrandAsset: (kind: "logo" | "seal", file: Blob, width: number, height: number) => request<{ id: string }>(`/api/v1/brand-assets/${kind}?width=${width}&height=${height}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } }),
  removeBrandAsset: (kind: "logo" | "seal") => request<{ removed: boolean }>(`/api/v1/brand-assets/${kind}`, { method: "DELETE" }),
  users: () => request<UserAccount[]>("/api/v1/users"),
  addUser: (data: { email: string; displayName: string; role: "ADMIN" | "MEMBER" }) => request<{ id: string }>("/api/v1/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: string, data: { displayName?: string; role?: "ADMIN" | "MEMBER"; active?: boolean }) => request<{ saved: boolean }>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateCounterparty: (id: string, data: object) => request<{ saved: boolean }>(`/api/v1/counterparties/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),
  archiveCounterparty: (id: string) => request<{ archived: boolean }>(`/api/v1/counterparties/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" }),
  updateProduct: (id: string, data: object) => request<{ saved: boolean }>(`/api/v1/products/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) }),
  archiveProduct: (id: string) => request<{ archived: boolean }>(`/api/v1/products/${encodeURIComponent(id)}/archive`, { method: "POST", body: "{}" }),
  saveOrganization: (data: object) => request<{ saved: boolean }>("/api/v1/organization", { method: "PATCH", body: JSON.stringify(data) }),
  documentsPage: (query="",type="",filters?:Partial<DocumentFilters>,cursor?:string) => {
    const params=new URLSearchParams({q:query,type,...pageQuery(cursor)});
    for(const [key,value] of Object.entries(filters??{})){if(value)params.set(key,value)}
    return requestEnvelope<DocumentSummary[]>(`/api/v1/documents?${params}`);
  },
  documents: async(query="",type="",filters?:Partial<DocumentFilters>) => (await api.documentsPage(query,type,filters)).data,
  document: (id: string) => request<DocumentRecord>(`/api/v1/documents/${encodeURIComponent(id)}`),
  createDocument: (data: DraftDocument) => request<{id:string;version:number}>("/api/v1/documents", { method: "POST", body: JSON.stringify(data) }),
  saveDocument: (id: string, version: number, data: DraftDocument) => request<{saved:boolean;version:number}>(`/api/v1/documents/${encodeURIComponent(id)}`, { method:"PATCH", headers:{"If-Match":String(version)}, body:JSON.stringify(data) }),
  previewPdf: async (id: string) => {
    const response = await fetch(`/api/v1/documents/${encodeURIComponent(id)}/preview`, {method:"POST"});
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as {error?:{message?:string}};
      throw new Error(body.error?.message ?? "PDFを生成できませんでした。");
    }
    return URL.createObjectURL(await response.blob());
  },
  sales: (month: string) => request<{month:string;salesYen:number;invoicedYen:number;paidYen:number;outstandingYen:number;overdueCount:number;definition:string}>(`/api/v1/sales/summary?month=${month}`),
  monthlySales: (endMonth:string,count=6) => request<Array<{month:string;salesYen:number}>>(`/api/v1/sales/monthly?endMonth=${endMonth}&count=${count}`),
  salesByCounterparty: (month:string) => request<Array<{counterparty_name:string;invoice_count:number;sales_yen:number;invoiced_yen:number}>>(`/api/v1/sales/counterparties?month=${month}`),
  overdueInvoices: () => request<Array<{id:string;number:string;subject:string;recipient_search_name:string;due_date:string;total_yen:number;outstanding_yen:number}>>("/api/v1/sales/overdue"),
  payments: (id:string) => request<PaymentSummary>(`/api/v1/documents/${encodeURIComponent(id)}/payments`),
  registerPayment: (id:string,data:{paymentDate:string;amountYen:number;method:string;note:string;confirmPrepayment?:boolean}) => requestIdempotently<object>(`payment:${id}`,`/api/v1/documents/${encodeURIComponent(id)}/payments`,data),
  duplicateDocument: (id:string) => requestIdempotently<{id:string}>(`duplicate:${id}`,`/api/v1/documents/${encodeURIComponent(id)}/duplicate`,{}),
  convertDocument: (id:string,type:"DN"|"INV"|"RC") => requestIdempotently<{id:string}>(`convert:${id}`,`/api/v1/documents/${encodeURIComponent(id)}/convert`,{type}),
  reviseDocument: (id:string,reason:string) => requestIdempotently<{id:string;revision:number}>(`revise:${id}`,`/api/v1/documents/${encodeURIComponent(id)}/revise`,{reason}),
  markSent: (id:string) => request<{sent:boolean}>(`/api/v1/documents/${encodeURIComponent(id)}/mark-sent`,{method:"POST",body:"{}"}),
  relatedDocuments: (id:string) => request<Array<{kind:string;created_at:string;related_document_id:string;related_revision_id:string;type:string;number:string|null;subject:string;issue_date:string}>>(`/api/v1/documents/${encodeURIComponent(id)}/relations`),
  revisions: (id:string) => request<RevisionSummary[]>(`/api/v1/documents/${encodeURIComponent(id)}/revisions`),
  correctPayment: (id:string,data:{reason:string;replacement:{paymentDate:string;amountYen:number;method:string;note:string}}) => requestIdempotently<object>(`payment-correction:${id}`,`/api/v1/payments/${encodeURIComponent(id)}/corrections`,data),
  refreshIssuer: (id:string,version:number) => request<{version:number}>(`/api/v1/documents/${encodeURIComponent(id)}/refresh-issuer`,{method:"POST",body:"{}",headers:{"If-Match":String(version)}}),
  abandonRevision: (id:string,version:number,revision:number,reason:string) => requestIdempotently<{abandoned:boolean}>(`abandon:${id}:${revision}`,`/api/v1/documents/${encodeURIComponent(id)}/abandon-revision`,{revision,reason},{"If-Match":String(version)}),
  issueStatus: (id:string) => request<{state:string;version:number;jobState:string|null;attemptCount:number;retryable:boolean}>(`/api/v1/documents/${encodeURIComponent(id)}/issue-status`),
  issue: (id:string,version:number) => requestIdempotently<{issued:boolean;number:string;pdfUrl:string;sha256:string}>(`issue:${id}:${version}`,`/api/v1/documents/${encodeURIComponent(id)}/issue`,{}, {"If-Match":String(version)}),
  counterpartiesPage: (query="",role:"customer"|"supplier"|"all"="customer",cursor?:string) => requestEnvelope<Counterparty[]>(`/api/v1/counterparties?${new URLSearchParams({q:query,role,...pageQuery(cursor)})}`),
  counterparties: async(query="",role:"customer"|"supplier"|"all"="customer") => (await api.counterpartiesPage(query,role)).data,
  addCounterparty: (data: object) => request<{id:string}>("/api/v1/counterparties",{method:"POST",body:JSON.stringify(data)}),
  productsPage: (query="",cursor?:string) => requestEnvelope<Product[]>(`/api/v1/products?${new URLSearchParams({q:query,...pageQuery(cursor)})}`),
  products: async(query="") => (await api.productsPage(query)).data,
  addProduct: (data: object) => request<{id:string}>("/api/v1/products",{method:"POST",body:JSON.stringify(data)}),
};
