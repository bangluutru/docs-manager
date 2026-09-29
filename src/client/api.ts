import type { DraftDocument, DocumentType } from "../domain/document";

export interface DocumentSummary {
  id: string; type: DocumentType; number: string | null; revision: number; state: string;
  subject: string; issue_date: string; due_date: string | null; total_yen: number; recipient_search_name: string;
  counterparty_id:string|null;paid_yen:number;payment_status:string|null;overdue:number;
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
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "通信に失敗しました。もう一度お試しください。");
  return body.data as T;
}
export const api = {
  getOrganization: () => request<Organization>("/api/v1/organization"),
  session: () => request<{actor:{role:"ADMIN"|"MEMBER";name:string;email:string}}>("/api/v1/session"),
  saveOrganization: (data: object) => request<{ saved: boolean }>("/api/v1/organization", { method: "PATCH", body: JSON.stringify(data) }),
  documents: (query = "", type = "", filters?:Partial<DocumentFilters>) => {const params=new URLSearchParams({q:query,type});for(const [key,value] of Object.entries(filters??{})){if(value)params.set(key,value)}return request<DocumentSummary[]>(`/api/v1/documents?${params.toString()}`)},
  document: (id: string) => request<{ id:string;number:string;revision:number;status:string;version:number;sentAt:string|null;data:DraftDocument;issuer:{legalName:string;postalCode?:string;address?:string;phone?:string;representative?:string;registrationNumber?:string};theme:"standard"|"modern";accentColor:string;tax:{mode:"exclusive"|"inclusive";lineRounding:"floor"|"half-up"|"ceil";taxRounding:"floor"|"half-up"|"ceil"} }>(`/api/v1/documents/${encodeURIComponent(id)}`),
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
  registerPayment: (id:string,data:{paymentDate:string;amountYen:number;method:string;note:string;confirmPrepayment?:boolean}) => request<object>(`/api/v1/documents/${encodeURIComponent(id)}/payments`,{method:"POST",body:JSON.stringify(data),headers:{"Idempotency-Key":crypto.randomUUID()}}),
  duplicateDocument: (id:string) => request<{id:string}>(`/api/v1/documents/${encodeURIComponent(id)}/duplicate`,{method:"POST",body:"{}",headers:{"Idempotency-Key":crypto.randomUUID()}}),
  convertDocument: (id:string,type:"DN"|"INV"|"RC") => request<{id:string}>(`/api/v1/documents/${encodeURIComponent(id)}/convert`,{method:"POST",body:JSON.stringify({type}),headers:{"Idempotency-Key":crypto.randomUUID()}}),
  reviseDocument: (id:string,reason:string) => request<{id:string;revision:number}>(`/api/v1/documents/${encodeURIComponent(id)}/revise`,{method:"POST",body:JSON.stringify({reason}),headers:{"Idempotency-Key":crypto.randomUUID()}}),
  markSent: (id:string) => request<{sent:boolean}>(`/api/v1/documents/${encodeURIComponent(id)}/mark-sent`,{method:"POST",body:"{}"}),
  relatedDocuments: (id:string) => request<Array<{kind:string;created_at:string;related_document_id:string;related_revision_id:string;type:string;number:string|null;subject:string;issue_date:string}>>(`/api/v1/documents/${encodeURIComponent(id)}/relations`),
  revisions: (id:string) => request<RevisionSummary[]>(`/api/v1/documents/${encodeURIComponent(id)}/revisions`),
  correctPayment: (id:string,data:{reason:string;replacement:{paymentDate:string;amountYen:number;method:string;note:string}}) => request<object>(`/api/v1/payments/${encodeURIComponent(id)}/corrections`,{method:"POST",body:JSON.stringify(data),headers:{"Idempotency-Key":crypto.randomUUID()}}),
  issue: (id:string) => request<{issued:boolean;number:string;pdfUrl:string;sha256:string}>(`/api/v1/documents/${encodeURIComponent(id)}/issue`,{method:"POST",body:"{}",headers:{"Idempotency-Key":crypto.randomUUID()}}),
  counterparties: (query = "") => request<Array<{id:string;name:string;kana:string;is_customer:number;is_supplier:number;postal_code:string;prefecture:string;address:string;building:string;phone:string}>>(`/api/v1/counterparties?q=${encodeURIComponent(query)}`),
  addCounterparty: (data: object) => request<{id:string}>("/api/v1/counterparties",{method:"POST",body:JSON.stringify(data)}),
  products: (query = "") => request<Array<{id:string;code:string;name:string;description:string;unit:string;unit_price_decimal:string;tax_class:string}>>(`/api/v1/products?q=${encodeURIComponent(query)}`),
  addProduct: (data: object) => request<{id:string}>("/api/v1/products",{method:"POST",body:JSON.stringify(data)}),
};
