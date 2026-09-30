import { z } from "zod";
import { TAX_RATES } from "./tax";

export const DOCUMENT_TYPES = ["QT", "DN", "INV", "RC", "PO", "OC"] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export const TaxClassSchema = z.enum(["STANDARD_10", "REDUCED_8", "NON_TAXABLE", "OUT_OF_SCOPE", "EXEMPT"]);
const BusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を入力してください").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}, "実在する日付を入力してください");
export const DecimalInputSchema = z.string().max(16).regex(/^(0|[1-9]\d*)(?:\.\d{1,4})?$/, "0以上、小数点以下4桁までの値を入力してください");
export const DocumentLineSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1, "品名・内容を入力してください").max(300),
  quantity: DecimalInputSchema.refine((value) => Number(value) > 0, "数量は0より大きい値を入力してください"),
  unit: z.string().trim().min(1).max(20),
  unitPrice: DecimalInputSchema,
  taxClass: TaxClassSchema,
});
export const DraftDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  recipientName: z.string().trim().max(200).default(""),
  recipientPostalCode: z.string().max(20).default(""),
  recipientAddress: z.string().max(300).default(""),
  recipientBuilding: z.string().max(200).default(""),
  recipientPhone: z.string().max(40).default(""),
  department: z.string().trim().max(100).default(""),
  contactName: z.string().trim().max(100).default(""),
  recipientOverride: z.string().trim().max(300).default(""),
  subject: z.string().trim().max(200).default(""),
  issueDate: BusinessDateSchema,
  transactionDate: BusinessDateSchema.optional(),
  periodStart: BusinessDateSchema.optional(),
  periodEnd: BusinessDateSchema.optional(),
  dueDate: BusinessDateSchema.optional(),
  validUntil: BusinessDateSchema.optional(),
  deliveryDate: BusinessDateSchema.optional(),
  requestedDeliveryDate: BusinessDateSchema.optional(),
  acceptedDate: BusinessDateSchema.optional(),
  deliveryPlace: z.string().trim().max(300).default(""),
  paymentTerms: z.string().trim().max(300).default(""),
  purchaseOrderNumber: z.string().trim().max(100).default(""),
  quotationReference: z.string().trim().max(100).default(""),
  purpose: z.string().trim().max(300).default(""),
  paymentMethod: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OTHER"]).default("BANK_TRANSFER"),
  counterpartyId: z.string().optional(),
  notes: z.string().max(2000).default(""),
  taxMode: z.enum(["exclusive", "inclusive"]).default("exclusive"),
  showAmounts: z.boolean().default(false),
  lines: z.array(DocumentLineSchema).min(1).max(200),
});
export type DraftDocument = z.infer<typeof DraftDocumentSchema>;

export const documentTitles: Record<DocumentType, string> = {
  QT: "御見積書", DN: "納品書", INV: "請求書", RC: "領収書", PO: "発注書", OC: "注文請書",
};
export const taxLabels: Record<keyof typeof TAX_RATES, string> = {
  STANDARD_10: "10%", REDUCED_8: "8%（軽減税率）", NON_TAXABLE: "非課税", OUT_OF_SCOPE: "不課税", EXEMPT: "免税",
};

export function recipientLine(data: Pick<DraftDocument, "recipientName" | "department" | "contactName" | "recipientOverride">): string[] {
  if (data.recipientOverride.trim()) return [data.recipientOverride.trim()];
  const lines = [data.recipientName.trim(), data.department.trim()].filter(Boolean);
  if (data.contactName.trim()) lines.push(`${data.contactName.trim()} 様`);
  else if (lines.length) lines[lines.length - 1] += " 御中";
  return lines;
}

export function documentTitle(type: DocumentType): string { return documentTitles[type]; }
