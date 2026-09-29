import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { z } from "zod";
import { DraftDocumentSchema, DOCUMENT_TYPES, type DraftDocument } from "../domain/document";
import { calculateDocumentTax } from "../domain/tax";
import { formatDocumentNumber, DEFAULT_NUMBERING } from "../domain/numbering";
import { renderDocumentHtml, type DocumentViewModel } from "../jds/render";
import puppeteer from "@cloudflare/puppeteer";

interface Env {
  DB: D1Database;
  DOCUMENT_ARTIFACTS: R2Bucket;
  BRAND_ASSETS: R2Bucket;
  BROWSER: Fetcher;
  ASSETS: Fetcher;
  APP_ENV: string;
  ORGANIZATION_ID: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SETUP_TOKEN?: string;
}
interface Actor { id: string; email: string; name: string; role: "ADMIN" | "MEMBER"; organizationId: string; subject?: string }
type AppEnv = { Bindings: Env; Variables: { actor: Actor; requestId: string } };

const app = new Hono<AppEnv>();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const constantTimeEqual = async (left: string, right: string) => {
  const [a,b] = await Promise.all([crypto.subtle.digest("SHA-256",new TextEncoder().encode(left)),crypto.subtle.digest("SHA-256",new TextEncoder().encode(right))]);
  const x=new Uint8Array(a);const y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
};

function errorResponse(code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 500) {
  return Response.json({ error: { code, message } }, { status });
}

app.use("/api/*", cors({ origin: [], allowMethods: ["GET", "POST", "PATCH"], allowHeaders: ["Content-Type", "Idempotency-Key", "If-Match"] }));
app.use("/api/v1/*", async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const localDemo = c.env.APP_ENV === "development" && ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  if (["POST","PATCH","PUT","DELETE"].includes(c.req.method) && c.req.header("Origin") && c.req.header("Origin") !== new URL(c.req.url).origin) {
    return errorResponse("INVALID_ORIGIN","このリクエストは受け付けられません。",403);
  }
  if (localDemo) {
    c.set("actor", { id: "local-developer", email: "local@localhost", name: "開発ユーザー", role: "ADMIN", organizationId: c.env.ORGANIZATION_ID });
    await next();
    return;
  }
  if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) return errorResponse("AUTH_NOT_CONFIGURED", "認証設定がありません。", 401);
  try {
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return errorResponse("UNAUTHENTICATED", "ログインしてください。", 401);
    const issuer = `https://${c.env.ACCESS_TEAM_DOMAIN}`;
    const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, keys, { issuer, audience: c.env.ACCESS_AUD });
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (!subject || !email) return errorResponse("INVALID_IDENTITY", "認証情報に社員情報がありません。", 401);
    const db = c.env.DB;
    let user = await db.prepare("SELECT id, organization_id, email, display_name, role FROM users WHERE access_subject=? AND active=1 AND organization_id=?").bind(subject, c.env.ORGANIZATION_ID).first<{ id: string; organization_id: string; email: string; display_name: string; role: "ADMIN" | "MEMBER" }>();
    if (!user) {
      await db.prepare("UPDATE users SET access_subject=?, updated_at=? WHERE lower(email)=? AND access_subject IS NULL AND active=1 AND organization_id=?")
        .bind(subject, now(), email, c.env.ORGANIZATION_ID).run();
      user = await db.prepare("SELECT id, organization_id, email, display_name, role FROM users WHERE access_subject=? AND active=1 AND organization_id=?").bind(subject, c.env.ORGANIZATION_ID).first();
    }
    if (!user) {
      const bootstrap = new URL(c.req.url).pathname === "/api/v1/setup/first-admin";
      const validSetup = bootstrap && !!c.env.SETUP_TOKEN && await constantTimeEqual(c.req.header("X-Setup-Token") ?? "",c.env.SETUP_TOKEN);
      const count = validSetup ? await db.prepare("SELECT COUNT(*) AS count FROM users WHERE organization_id=?").bind(c.env.ORGANIZATION_ID).first<{count:number}>() : null;
      if (!validSetup || Number(count?.count ?? 1) !== 0) return errorResponse("USER_NOT_PROVISIONED", "管理者に利用登録を依頼してください。", 403);
      c.set("actor", { id:`pending:${subject}`,subject,email,name:typeof payload.name==="string"?payload.name:email,role:"ADMIN",organizationId:c.env.ORGANIZATION_ID });
    } else {
      c.set("actor", { id: user.id,subject,email: user.email, name: user.display_name, role: user.role, organizationId: user.organization_id });
    }
    await next();
  } catch {
    return errorResponse("INVALID_ACCESS_TOKEN", "ログイン状態を確認できませんでした。", 401);
  }
});

app.use("/api/v1/*",async(c,next)=>{await next();c.header("Cache-Control","private, no-store");c.header("X-Content-Type-Options","nosniff");c.header("Referrer-Policy","no-referrer");});

app.post("/api/v1/setup/first-admin",async(c)=>{
  const actor=c.get("actor");
  if(!actor.id.startsWith("pending:")||!actor.subject||!c.env.SETUP_TOKEN||!await constantTimeEqual(c.req.header("X-Setup-Token")??"",c.env.SETUP_TOKEN))return errorResponse("SETUP_NOT_ALLOWED","管理者の初期設定を実行できません。",403);
  const timestamp=now();const adminId=id();
  const statements=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users(id,organization_id,access_subject,email,display_name,role,active,created_at,updated_at)
      SELECT ?,?,?,?,?, 'ADMIN',1,?,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE organization_id=?)`).bind(adminId,actor.organizationId,actor.subject,actor.email,actor.name,timestamp,timestamp,actor.organizationId),
    c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,occurred_at,request_id,details_json)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND organization_id=?)`).bind(id(),actor.organizationId,adminId,"FIRST_ADMIN_CREATED","USER",adminId,timestamp,c.get("requestId"),"{}",adminId,actor.organizationId),
  ]);
  if((statements[0].meta.changes??0)!==1)return errorResponse("SETUP_COMPLETE","初期管理者はすでに設定されています。",409);
  return c.json({data:{id:adminId,role:"ADMIN"}},201);
});

function requireAdmin(actor: Actor): boolean { return actor.role === "ADMIN"; }
const CounterpartyInput = z.object({
  name: z.string().trim().min(1).max(200), kana: z.string().max(200).optional().default(""),
  isCustomer: z.boolean().default(true), isSupplier: z.boolean().default(false),
  postalCode: z.string().max(20).optional().default(""), prefecture: z.string().max(30).optional().default(""),
  address: z.string().max(300).optional().default(""), building: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional().default(""), email: z.string().max(200).optional().default(""),
  website: z.string().max(300).optional().default(""), notes: z.string().max(2000).optional().default(""),
}).refine((value) => value.isCustomer || value.isSupplier, "取引区分を選択してください。");
const ProductInput = z.object({
  code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200),
  description: z.string().max(300).optional().default(""), unit: z.string().trim().min(1).max(20),
  unitPrice: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
  taxClass: z.enum(["STANDARD_10", "REDUCED_8", "NON_TAXABLE", "OUT_OF_SCOPE", "EXEMPT"]),
});

app.get("/api/v1/session", (c) => c.json({ data: { actor: c.get("actor"), organizationId: c.get("actor").organizationId } }));

app.get("/api/v1/organization", async (c) => {
  const orgId = c.get("actor").organizationId;
  const row = await c.env.DB.prepare(`SELECT o.*, s.default_tax_mode, s.tax_rounding, s.line_rounding, s.theme, s.accent_color, s.qualified_mode, s.registration_number
    FROM organizations o JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?`).bind(orgId).first<Record<string, unknown>>();
  return row ? c.json({ data: row }) : errorResponse("NOT_FOUND", "会社情報がありません。", 404);
});

app.patch("/api/v1/organization", async (c) => {
  const actor = c.get("actor");
  if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
  const schema = z.object({ legal_name: z.string().trim().min(1).max(200), display_name: z.string().trim().min(1).max(200), postal_code: z.string().max(20), prefecture: z.string().max(30), address: z.string().max(300), building: z.string().max(200), phone: z.string().max(40), representative: z.string().max(100), registration_number: z.string().regex(/^T\d{13}$/).or(z.literal("")), qualified_mode: z.boolean(), theme: z.enum(["standard", "modern"]), accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "会社情報を確認してください。", 422);
  const d = parsed.data;
  const timestamp = now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE organizations SET legal_name=?,display_name=?,postal_code=?,prefecture=?,address=?,building=?,phone=?,representative=?,updated_at=? WHERE id=?`).bind(d.legal_name,d.display_name,d.postal_code,d.prefecture,d.address,d.building,d.phone,d.representative,timestamp,actor.organizationId),
    c.env.DB.prepare(`UPDATE organization_settings SET registration_number=?,qualified_mode=?,theme=?,accent_color=?,version=version+1,updated_at=? WHERE organization_id=?`).bind(d.registration_number || null,Number(d.qualified_mode),d.theme,d.accent_color,timestamp,actor.organizationId),
    c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,occurred_at,request_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id(),actor.organizationId,actor.id,"ORGANIZATION_UPDATED","ORGANIZATION",actor.organizationId,timestamp,c.get("requestId"),JSON.stringify({fields:Object.keys(d)})),
  ]);
  if (result.some((item) => !item.success)) return errorResponse("SAVE_FAILED", "保存できませんでした。", 500);
  return c.json({ data: { saved: true } });
});

app.get("/api/v1/counterparties", async (c) => {
  const orgId = c.get("actor").organizationId;
  const query = (c.req.query("q") ?? "").trim().slice(0, 100);
  const role = c.req.query("role") ?? "customer";
  if (!(["customer", "supplier", "all"] as const).includes(role as "customer" | "supplier" | "all")) return errorResponse("VALIDATION_ERROR", "取引先区分を確認してください。", 422);
  const roleFilter = role === "all" ? "1=1" : `${role === "supplier" ? "is_supplier" : "is_customer"}=1`;
  const rows = await c.env.DB.prepare(`SELECT id,name,kana,is_customer,is_supplier,postal_code,prefecture,address,building,phone,email,notes,active FROM counterparties WHERE organization_id=? AND active=1 AND ${roleFilter} AND (?='' OR normalized_name LIKE ? ESCAPE '\\') ORDER BY normalized_name,id LIMIT 100`)
    .bind(orgId,query,`%${query.replace(/[\\%_]/g,"\\$&").toLowerCase()}%`).all();
  return c.json({ data: rows.results });
});

app.post("/api/v1/counterparties", async (c) => {
  const actor = c.get("actor");
  const parsed = CounterpartyInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "取引先情報を確認してください。", 422);
  const d = parsed.data; const key = id(); const timestamp = now();
  const normalized = d.name.normalize("NFKC").toLowerCase();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO counterparties(id,organization_id,name,kana,normalized_name,is_customer,is_supplier,postal_code,prefecture,address,building,phone,email,website,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(key,actor.organizationId,d.name,d.kana,normalized,Number(d.isCustomer),Number(d.isSupplier),d.postalCode,d.prefecture,d.address,d.building,d.phone,d.email,d.website,d.notes,timestamp,timestamp),
    c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,occurred_at,request_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id(),actor.organizationId,actor.id,"COUNTERPARTY_CREATED","COUNTERPARTY",key,timestamp,c.get("requestId"),"{}"),
  ]);
  return c.json({ data: { id: key, ...d } }, 201);
});

app.get("/api/v1/products", async (c) => {
  const orgId = c.get("actor").organizationId; const query = (c.req.query("q") ?? "").trim().slice(0,100);
  const rows = await c.env.DB.prepare("SELECT id,code,name,description,unit,unit_price_decimal,tax_class FROM products WHERE organization_id=? AND active=1 AND (?='' OR name LIKE ? OR code LIKE ?) ORDER BY name,id LIMIT 100")
    .bind(orgId,query,`%${query}%`,`%${query}%`).all();
  return c.json({ data: rows.results });
});

app.post("/api/v1/products", async (c) => {
  const actor = c.get("actor"); const parsed = ProductInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "商品・サービス情報を確認してください。", 422);
  const d = parsed.data; const productId = id(); const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO products(id,organization_id,code,name,description,unit,unit_price_decimal,tax_class,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(productId,actor.organizationId,d.code,d.name,d.description,d.unit,d.unitPrice,d.taxClass,timestamp,timestamp),
    c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,occurred_at,request_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id(),actor.organizationId,actor.id,"PRODUCT_CREATED","PRODUCT",productId,timestamp,c.get("requestId"),"{}"),
  ]);
  return c.json({ data: { id: productId, ...d } }, 201);
});

const RevisionRowSchema = z.object({
  id: z.string(), document_id: z.string(), type: z.enum(DOCUMENT_TYPES), revision: z.number(), state: z.string(),
  number: z.string().nullable(), version: z.number(), recipient_snapshot_json: z.string(), issuer_snapshot_json: z.string(),
  type_fields_json: z.string(), tax_summary_json: z.string(), render_settings_json: z.string(), bank_snapshot_json: z.string(),
  sent_at: z.string().nullable().optional(),
  counterparty_id: z.string().nullable(),
  issue_date: z.string(), transaction_date: z.string().nullable(), period_start: z.string().nullable(), period_end: z.string().nullable(),
  due_date: z.string().nullable(), subject: z.string(), tax_mode: z.enum(["exclusive", "inclusive"]),
  tax_rounding: z.enum(["floor", "half-up", "ceil"]), line_rounding: z.enum(["floor", "half-up", "ceil"]), notes: z.string(),
  total_yen: z.number(),
});

async function revisionFor(c: Context<AppEnv>, docId: string, effective = false) {
  const actor = c.get("actor");
  const row = await c.env.DB.prepare(`SELECT r.*,d.type,d.number,d.counterparty_id FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.document_id=d.id
    WHERE d.organization_id=? AND d.id=? AND r.id=${effective ? "d.current_issued_revision_id" : "COALESCE(d.active_draft_revision_id,d.current_issued_revision_id)"}`)
    .bind(actor.organizationId,docId).first<Record<string, unknown>>();
  if (!row) return null;
  const items = await c.env.DB.prepare("SELECT id,description,quantity_decimal,unit,unit_price_decimal,tax_class FROM document_items WHERE organization_id=? AND revision_id=? ORDER BY position")
    .bind(actor.organizationId,row.id).all<Record<string, unknown>>();
  return { row: RevisionRowSchema.parse(row), items: items.results };
}

function viewModel(record: Awaited<ReturnType<typeof revisionFor>>): DocumentViewModel {
  if (!record) throw new Error("Document not found");
  const row = record.row;
  const recipient = JSON.parse(row.recipient_snapshot_json) as { name?: string; postalCode?:string; address?:string; building?:string; phone?:string; department?: string; contact?: string; override?: string };
  const issuer = JSON.parse(row.issuer_snapshot_json) as { legalName?: string; postalCode?: string; address?: string; phone?: string; representative?: string; registrationNumber?: string };
  const typeFields = JSON.parse(String((row as unknown as Record<string, unknown>).type_fields_json ?? "{}")) as Partial<DraftDocument>;
  const renderSettings = JSON.parse(row.render_settings_json) as {theme?:"standard"|"modern";accentColor?:string};
  return {
    id: row.document_id, number: row.number ?? "", revision: row.revision, status: row.state,
    data: { type: row.type, recipientName: recipient.name ?? "",recipientPostalCode:recipient.postalCode??"",recipientAddress:recipient.address??"",recipientBuilding:recipient.building??"",recipientPhone:recipient.phone??"", department: recipient.department ?? "", contactName: recipient.contact ?? "", recipientOverride: recipient.override ?? "", subject: row.subject, issueDate: row.issue_date, transactionDate:row.transaction_date??undefined,periodStart:row.period_start??undefined,periodEnd:row.period_end??undefined,dueDate: row.due_date ?? undefined, validUntil: typeFields.validUntil??undefined, deliveryDate:typeFields.deliveryDate??undefined,requestedDeliveryDate:typeFields.requestedDeliveryDate??undefined,acceptedDate:typeFields.acceptedDate??undefined,deliveryPlace:typeFields.deliveryPlace??"",paymentTerms:typeFields.paymentTerms??"",purchaseOrderNumber:typeFields.purchaseOrderNumber??"",quotationReference:typeFields.quotationReference??"",purpose:typeFields.purpose??"",paymentMethod:typeFields.paymentMethod??"BANK_TRANSFER",showAmounts: typeFields.showAmounts ?? false,counterpartyId:row.counterparty_id??undefined, notes: row.notes, taxMode: row.tax_mode, lines: record.items.map((item:Record<string,unknown>) => ({ id: String(item.id), description: String(item.description), quantity: String(item.quantity_decimal), unit: String(item.unit), unitPrice: String(item.unit_price_decimal), taxClass: item.tax_class as DraftDocument["lines"][number]["taxClass"] })) },
    issuer: { legalName: issuer.legalName ?? "", postalCode: issuer.postalCode, address: issuer.address, phone: issuer.phone, representative: issuer.representative, registrationNumber: issuer.registrationNumber },
    theme: renderSettings.theme ?? "standard", accentColor: renderSettings.accentColor ?? "#315b78", tax: { mode: row.tax_mode, taxRounding: row.tax_rounding, lineRounding: row.line_rounding },
  };
}

type DraftCreateOptions = {
  documentId?: string;
  revision?: number;
  previousRevisionId?: string;
  snapshot?: NonNullable<Awaited<ReturnType<typeof revisionFor>>>["row"];
  relation?: { sourceRevisionId: string; targetDocumentId: string; kind: "CONVERTED_FROM" | "DUPLICATED_FROM" | "RECEIPT_FOR" | "ORDER_REFERENCE" };
  action?: string;
  correctionReason?: string;
  idempotency?: { operation: string; key: string; requestHash: string };
};

async function insertDraft(c: Context<AppEnv>, data: DraftDocument, options: DraftCreateOptions = {}) {
  const actor = c.get("actor"); const orgId = actor.organizationId; const timestamp = now();
  const docId = options.documentId ?? id(); const revisionId = id(); const revision = options.revision ?? 0;
  const org = await c.env.DB.prepare(`SELECT o.legal_name,o.display_name,o.postal_code,o.prefecture,o.address,o.building,o.phone,o.representative,s.default_tax_mode,s.tax_rounding,s.line_rounding,s.theme,s.accent_color,s.qualified_mode,s.registration_number,s.bank_json
    FROM organizations o JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?`).bind(orgId).first<Record<string, unknown>>();
  if (!org) throw new Error("ORGANIZATION_NOT_FOUND");
  const snapshot = options.snapshot;
  const taxRounding = snapshot?.tax_rounding ?? String(org.tax_rounding);
  const lineRounding = snapshot?.line_rounding ?? String(org.line_rounding);
  const tax = calculateDocumentTax(data.lines, { mode: data.taxMode, lineRounding: lineRounding as "floor"|"half-up"|"ceil", taxRounding: taxRounding as "floor"|"half-up"|"ceil" });
  const recipient = { name:data.recipientName,postalCode:data.recipientPostalCode,address:data.recipientAddress,building:data.recipientBuilding,phone:data.recipientPhone,department:data.department,contact:data.contactName,override:data.recipientOverride };
  const issuerJson = snapshot?.issuer_snapshot_json ?? JSON.stringify({ legalName:org.legal_name || org.display_name,postalCode:org.postal_code,address:[org.prefecture,org.address,org.building].filter(Boolean).join(""),phone:org.phone,representative:org.representative,registrationNumber:org.registration_number });
  const bankJson = snapshot?.bank_snapshot_json ?? String(org.bank_json ?? "{}");
  const renderJson = snapshot?.render_settings_json ?? JSON.stringify({theme:org.theme,accentColor:org.accent_color});
  const response = { id:docId,revision,version:1,state:"DRAFT",number:null,totals:tax };
  const statements: D1PreparedStatement[] = [];
  if (options.idempotency) statements.push(c.env.DB.prepare(`INSERT INTO idempotency_requests(organization_id,actor_id,operation,key,request_hash,resource_id,response_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(orgId,actor.id,options.idempotency.operation,options.idempotency.key,options.idempotency.requestHash,docId,JSON.stringify(response),"COMPLETED",timestamp));
  if (!options.documentId) statements.push(c.env.DB.prepare("INSERT INTO documents(id,organization_id,type,counterparty_id,active_draft_revision_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(docId,orgId,data.type,data.counterpartyId||null,revisionId,actor.id,timestamp));
  statements.push(c.env.DB.prepare(`INSERT INTO document_revisions(id,organization_id,document_id,revision,previous_revision_id,state,version,counterparty_id,recipient_snapshot_json,recipient_search_name,issuer_snapshot_json,bank_snapshot_json,render_settings_json,issue_date,transaction_date,period_start,period_end,due_date,subject,tax_mode,tax_rounding,line_rounding,subtotal_yen,tax_yen,total_yen,tax_summary_json,notes,type_fields_json,snapshot_schema_version,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'DRAFT',1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
    .bind(revisionId,orgId,docId,revision,options.previousRevisionId??null,data.counterpartyId||null,JSON.stringify(recipient),data.recipientName,issuerJson,bankJson,renderJson,data.issueDate,data.transactionDate??null,data.periodStart??null,data.periodEnd??null,data.dueDate ?? null,data.subject,data.taxMode,taxRounding,lineRounding,tax.subtotalYen,tax.taxYen,tax.totalYen,JSON.stringify(tax.groups),data.notes,JSON.stringify({validUntil:data.validUntil ?? null,showAmounts:data.showAmounts,deliveryDate:data.deliveryDate,requestedDeliveryDate:data.requestedDeliveryDate,acceptedDate:data.acceptedDate,deliveryPlace:data.deliveryPlace,paymentTerms:data.paymentTerms,purchaseOrderNumber:data.purchaseOrderNumber,quotationReference:data.quotationReference,purpose:data.purpose,paymentMethod:data.paymentMethod,correctionReason:options.correctionReason}),actor.id,timestamp,timestamp));
  for (const [position,line] of data.lines.entries()) statements.push(c.env.DB.prepare(`INSERT INTO document_items(id,organization_id,revision_id,position,description,quantity_decimal,unit,unit_price_decimal,tax_class,line_amount_yen) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id(),orgId,revisionId,position,line.description,line.quantity,line.unit,line.unitPrice,line.taxClass,tax.lines[position].amountYen));
  if (options.documentId) statements.push(c.env.DB.prepare("UPDATE documents SET active_draft_revision_id=? WHERE organization_id=? AND id=? AND active_draft_revision_id IS NULL")
    .bind(revisionId,orgId,docId));
  if (options.relation) statements.push(c.env.DB.prepare(`INSERT INTO document_relations(id,organization_id,source_revision_id,target_document_id,kind,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(id(),orgId,options.relation.sourceRevisionId==="$new"?revisionId:options.relation.sourceRevisionId,options.relation.targetDocumentId==="$new"?docId:options.relation.targetDocumentId,options.relation.kind,actor.id,timestamp));
  statements.push(c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id(),orgId,actor.id,options.action??"DOCUMENT_CREATED","DOCUMENT",docId,revisionId,timestamp,c.get("requestId"),JSON.stringify({type:data.type,revision,previousRevisionId:options.previousRevisionId??null,reason:options.correctionReason})));
  const results = await c.env.DB.batch(statements);
  if (results.some((part) => !part.success)) throw new Error("DRAFT_INSERT_FAILED");
  if (options.documentId && (results[results.length - (options.relation?3:2)].meta.changes ?? 0) !== 1) throw new Error("ACTIVE_DRAFT_CONFLICT");
  return response;
}

async function requestFingerprint(body: unknown) { return sha256(new TextEncoder().encode(JSON.stringify(body))); }
function idempotencyKey(c: Context<AppEnv>): string | null {
  const value = c.req.header("Idempotency-Key")?.trim();
  return value && value.length >= 8 && value.length <= 200 ? value : null;
}
async function replayIdempotency(c: Context<AppEnv>, operation: string, key: string, hash: string) {
  const prior = await c.env.DB.prepare("SELECT request_hash,response_json,state FROM idempotency_requests WHERE organization_id=? AND actor_id=? AND operation=? AND key=?")
    .bind(c.get("actor").organizationId,c.get("actor").id,operation,key).first<{request_hash:string;response_json:string|null;state:string}>();
  if (!prior) return null;
  if (prior.request_hash !== hash) return errorResponse("IDEMPOTENCY_CONFLICT","同じリクエストキーが別の内容に使われています。",409);
  if (prior.state !== "COMPLETED" || !prior.response_json) return errorResponse("REQUEST_IN_PROGRESS","同じリクエストを処理しています。",409);
  return c.json({data:JSON.parse(prior.response_json)});
}

function copyBuffer(data: Uint8Array): ArrayBuffer { const copy=new Uint8Array(data.byteLength);copy.set(data);return copy.buffer; }
async function sha256(data: Uint8Array): Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",copyBuffer(data));
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}
async function makePdf(env:Env,html:string):Promise<Uint8Array>{
  const browser=await puppeteer.launch(env.BROWSER);
  try{
    const page=await browser.newPage();
    await page.setContent(html,{waitUntil:"load"});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>undefined)))});
    const pages=await page.evaluate(()=>Math.max(1,Math.ceil(document.documentElement.scrollHeight/(297*96/25.4))));
    if(pages>40)throw new Error("PDF_PAGE_LIMIT");
    const pdf=Uint8Array.from(await page.pdf({format:"A4",printBackground:true,preferCSSPageSize:true}));
    await page.close();
    return pdf;
  }finally{await browser.close();}
}

app.get("/api/v1/documents", async (c) => {
  const actor = c.get("actor"); const type = c.req.query("type"); const query = (c.req.query("q") ?? "").trim().slice(0,100);
  if (type && !(DOCUMENT_TYPES as readonly string[]).includes(type)) return errorResponse("VALIDATION_ERROR", "帳票種別を確認してください。", 422);
  const from=c.req.query("from")??"";const to=c.req.query("to")??"";const min=c.req.query("minAmount")??"";const max=c.req.query("maxAmount")??"";const counterparty=c.req.query("counterpartyId")??"";const status=c.req.query("status")??"";
  const validDate=(value:string)=>{if(!value)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(`${value}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value};
  if(!validDate(from)||!validDate(to)||from&&to&&from>to||min&&(!/^\d+$/.test(min)||!Number.isSafeInteger(Number(min)))||max&&(!/^\d+$/.test(max)||!Number.isSafeInteger(Number(max)))||min&&max&&Number(min)>Number(max))return errorResponse("VALIDATION_ERROR","検索条件の日付または金額を確認してください。",422);
  if(status&&!['DRAFT','ISSUED','UNPAID','PARTIALLY_PAID','PAID','OVERDUE'].includes(status))return errorResponse("VALIDATION_ERROR","帳票状態を確認してください。",422);
  const conditions:string[]=["(?='' OR type=?)","(?='' OR number LIKE ? OR recipient_search_name LIKE ? OR subject LIKE ?)","(?='' OR issue_date>=?)","(?='' OR issue_date<=?)","(?='' OR total_yen>=?)","(?='' OR total_yen<=?)","(?='' OR counterparty_id=?)"];
  const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  const binds:unknown[]=[today,actor.organizationId,type??"",type??"",query,`${query}%`,`%${query}%`,`%${query}%`,from,from,to,to,min,min===""?0:Number(min),max,max===""?0:Number(max),counterparty,counterparty];
  if(status==="DRAFT")conditions.push("state='DRAFT'");
  if(status==="ISSUED")conditions.push("state='ISSUED'");
  if(status==="UNPAID")conditions.push("payment_status='UNPAID'");
  if(status==="PARTIALLY_PAID")conditions.push("payment_status='PARTIALLY_PAID'");
  if(status==="PAID")conditions.push("payment_status='PAID'");
  if(status==="OVERDUE")conditions.push("overdue=1");
  const rows = await c.env.DB.prepare(`WITH candidates AS (
      SELECT d.id,d.type,d.number,d.counterparty_id,r.revision,r.state,r.subject,r.issue_date,r.due_date,r.total_yen,r.recipient_search_name,
        COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0) paid_yen,
        CASE WHEN d.type='INV' AND r.state='ISSUED' AND r.total_yen>0 AND COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0)=r.total_yen THEN 'PAID'
          WHEN d.type='INV' AND r.state='ISSUED' AND COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0)>0 THEN 'PARTIALLY_PAID'
          WHEN d.type='INV' AND r.state='ISSUED' THEN 'UNPAID' ELSE NULL END payment_status,
        CASE WHEN d.type='INV' AND r.state='ISSUED' AND r.due_date IS NOT NULL AND r.due_date<?
          AND r.total_yen>COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0) THEN 1 ELSE 0 END overdue
      FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.document_id=d.id AND r.id=COALESCE(d.active_draft_revision_id,d.current_issued_revision_id)
      WHERE d.organization_id=?
    ) SELECT * FROM candidates WHERE ${conditions.join(" AND ")} ORDER BY issue_date DESC,id DESC LIMIT 100`)
    .bind(...binds).all();
  return c.json({ data: rows.results });
});

app.post("/api/v1/documents", async (c) => {
  const parsed = DraftDocumentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "帳票の入力内容を確認してください。", 422);
  try { const result=await insertDraft(c,parsed.data); return c.json({data:result},201); }
  catch(error){console.error("document_create_failed",{requestId:c.get("requestId"),error:String(error)});return errorResponse("SAVE_FAILED","帳票を保存できませんでした。",409);}
});

app.get("/api/v1/documents/:id", async (c) => {
  try {
    const record = await revisionFor(c,c.req.param("id"));
    if (!record) return errorResponse("NOT_FOUND", "帳票が見つかりません。", 404);
    return c.json({ data: { ...viewModel(record), version: record.row.version, sentAt:record.row.sent_at??null } });
  } catch (error) {
    console.error("document_read_failed", {requestId:c.get("requestId"),error:String(error)});
    return errorResponse("DOCUMENT_READ_FAILED", "帳票を読み込めませんでした。", 500);
  }
});

app.get("/api/v1/documents/:id/payments", async (c) => {
  const record=await revisionFor(c,c.req.param("id"),true);
  if(!record||record.row.type!=="INV"||record.row.state!=="ISSUED")return errorResponse("NOT_FOUND","発行済み請求書が見つかりません。",404);
  const orgId=c.get("actor").organizationId;const docId=c.req.param("id");
  const payments=await c.env.DB.prepare(`SELECT id,payment_date,amount_yen,method,note,created_at,voided_at,correction_reason,replaces_payment_id
    FROM payments WHERE organization_id=? AND invoice_document_id=? ORDER BY payment_date,id`).bind(orgId,docId).all();
  const paid=payments.results.filter((item)=>!item.voided_at).reduce((sum,item)=>sum+Number(item.amount_yen),0);
  const outstanding=record.row.total_yen-paid;
  return c.json({data:{totalYen:record.row.total_yen,paidYen:paid,outstandingYen:outstanding,status:outstanding===0?"PAID":paid===0?"UNPAID":"PARTIALLY_PAID",payments:payments.results}});
});

app.post("/api/v1/documents/:id/payments", async (c) => {
  const actor=c.get("actor");const docId=c.req.param("id");
  const schema=z.object({paymentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amountYen:z.number().int().positive().max(2_000_000_000),method:z.enum(["BANK_TRANSFER","CASH","CARD","OTHER"]),note:z.string().max(1000).optional().default(""),confirmPrepayment:z.boolean().optional().default(false)});
  const body=schema.safeParse(await c.req.json().catch(()=>null));
  if(!body.success)return errorResponse("VALIDATION_ERROR","入金内容を確認してください。",422);
  const parsedDate=new Date(`${body.data.paymentDate}T00:00:00Z`);
  if(!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==body.data.paymentDate)return errorResponse("VALIDATION_ERROR","入金日を確認してください。",422);
  const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  if(body.data.paymentDate>today)return errorResponse("VALIDATION_ERROR","未来の日付は登録できません。",422);
  const record=await revisionFor(c,docId,true);
  if(!record||record.row.type!=="INV"||record.row.state!=="ISSUED")return errorResponse("NOT_FOUND","発行済み請求書が見つかりません。",404);
  if(body.data.paymentDate<record.row.issue_date&&(!body.data.confirmPrepayment||!body.data.note.trim()))return errorResponse("PREPAYMENT_CONFIRMATION_REQUIRED","請求日より前の入金には確認と備考が必要です。",422);
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const hash=await requestFingerprint(body.data);const operation=`payment:${docId}`;
  const replay=await replayIdempotency(c,operation,key,hash);if(replay)return replay;
  const paymentId=id();const timestamp=now();const response={id:paymentId,invoiceDocumentId:docId,paymentDate:body.data.paymentDate,amountYen:body.data.amountYen,method:body.data.method,note:body.data.note};
  try{
    const results=await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO idempotency_requests(organization_id,actor_id,operation,key,request_hash,resource_id,response_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(actor.organizationId,actor.id,operation,key,hash,paymentId,JSON.stringify(response),"COMPLETED",timestamp),
      c.env.DB.prepare(`INSERT INTO payments(id,organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(paymentId,actor.organizationId,docId,record.row.id,body.data.paymentDate,body.data.amountYen,body.data.method,body.data.note,actor.id,timestamp),
      c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND organization_id=?)`).bind(id(),actor.organizationId,actor.id,"PAYMENT_REGISTERED","PAYMENT",paymentId,record.row.id,timestamp,c.get("requestId"),JSON.stringify({invoiceId:docId,amountYen:body.data.amountYen}),paymentId,actor.organizationId),
    ]);
    if((results[1].meta.changes??0)!==1)return errorResponse("PAYMENT_CONFLICT","入金を登録できませんでした。残額を確認してください。",409);
    return c.json({data:response},201);
  }catch(error){const race=await replayIdempotency(c,operation,key,hash);if(race)return race;const message=String(error);return errorResponse(message.includes("payment exceeds")?"OVERPAYMENT":"PAYMENT_CONFLICT",message.includes("payment exceeds")?"入金額が請求残額を超えています。":"入金を登録できませんでした。残額を確認して再試行してください。",409);}
});

app.post("/api/v1/documents/:id/duplicate",async(c)=>{
  const sourceId=c.req.param("id");const body=await c.req.json().catch(()=>({}));
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const hash=await requestFingerprint(body);const operation=`duplicate:${sourceId}`;const replay=await replayIdempotency(c,operation,key,hash);if(replay)return replay;
  const source=await revisionFor(c,sourceId);if(!source)return errorResponse("NOT_FOUND","複製元の帳票が見つかりません。",404);
  const data=viewModel(source).data;const date=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  data.issueDate=date;data.dueDate=undefined;data.validUntil=undefined;
  if(data.type==="INV"){data.transactionDate=date;data.periodStart=undefined;data.periodEnd=undefined;}
  if(data.type==="DN")data.deliveryDate=date;
  if(data.type==="OC")data.acceptedDate=date;
  if(data.type==="PO")data.requestedDeliveryDate=undefined;
  try{
    const response=await insertDraft(c,data,{relation:{sourceRevisionId:"$new",targetDocumentId:sourceId,kind:"DUPLICATED_FROM"},action:"DOCUMENT_DUPLICATED",idempotency:{operation,key,requestHash:hash}});
    return c.json({data:response},201);
  }catch(error){const race=await replayIdempotency(c,operation,key,hash);if(race)return race;return errorResponse("DUPLICATE_CONFLICT","帳票を複製できませんでした。",409);}
});

app.post("/api/v1/documents/:id/convert",async(c)=>{
  const actor=c.get("actor");const sourceId=c.req.param("id");
  const bodySchema=z.object({type:z.enum(["DN","INV","RC"])});const parsed=bodySchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse("VALIDATION_ERROR","変換先の帳票種別を確認してください。",422);
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const hash=await requestFingerprint(parsed.data);const operation=`convert:${sourceId}`;const replay=await replayIdempotency(c,operation,key,hash);if(replay)return replay;
  const source=await revisionFor(c,sourceId,true);if(!source||source.row.state!=="ISSUED")return errorResponse("CONVERSION_SOURCE_INVALID","発行済みの帳票のみ変換できます。",409);
  const target=parsed.data.type;const allowed=(source.row.type==="QT"&&["DN","INV"].includes(target))||(source.row.type==="DN"&&target==="INV")||(source.row.type==="INV"&&target==="RC");
  if(!allowed)return errorResponse("CONVERSION_NOT_ALLOWED","この帳票の組み合わせは変換できません。",422);
  const data=viewModel(source).data;const date=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  data.type=target;data.issueDate=date;data.dueDate=undefined;data.validUntil=undefined;
  if(source.row.type==="QT"&&target==="DN")data.deliveryDate=date;
  if(target==="INV"&&source.row.type==="QT"){data.quotationReference=source.row.number??"";data.transactionDate=date;data.periodStart=undefined;data.periodEnd=undefined;}
  if(target==="INV"&&source.row.type==="DN"){data.deliveryDate=data.deliveryDate??source.row.issue_date;data.transactionDate=data.deliveryDate;data.periodStart=undefined;data.periodEnd=undefined;}
  let relation:{sourceRevisionId:string;targetDocumentId:string;kind:"CONVERTED_FROM"|"RECEIPT_FOR"}={sourceRevisionId:"$new",targetDocumentId:sourceId,kind:"CONVERTED_FROM"};
  if(target==="RC"){
    const paymentRows=await c.env.DB.prepare("SELECT payment_date,method,amount_yen FROM payments WHERE organization_id=? AND invoice_document_id=? AND voided_at IS NULL ORDER BY payment_date DESC,id DESC").bind(actor.organizationId,sourceId).all<{payment_date:string;method:string;amount_yen:number}>();
    const paid=paymentRows.results.reduce((sum,p)=>sum+p.amount_yen,0);
    if(source.row.total_yen<=0||paid!==source.row.total_yen)return errorResponse("RECEIPT_REQUIRES_FULL_PAYMENT","全額入金済みの請求書から領収書を作成できます。",409);
    data.issueDate=paymentRows.results[0]?.payment_date??date;data.paymentMethod=new Set(paymentRows.results.map((payment)=>payment.method)).size===1?(paymentRows.results[0]?.method as DraftDocument["paymentMethod"]??"OTHER"):"OTHER";
    data.purpose=source.row.subject?`${source.row.subject}代として`:"商品代として";data.dueDate=undefined;data.validUntil=undefined;data.transactionDate=undefined;data.periodStart=undefined;data.periodEnd=undefined;data.notes="";
    relation={sourceRevisionId:source.row.id,targetDocumentId:"$new",kind:"RECEIPT_FOR"};
  }
  try{
    const response=await insertDraft(c,data,{snapshot:source.row,relation,action:"DOCUMENT_CONVERTED",idempotency:{operation,key,requestHash:hash}});
    return c.json({data:response},201);
  }catch(error){const race=await replayIdempotency(c,operation,key,hash);if(race)return race;const message=String(error);return errorResponse("CONVERSION_CONFLICT",message.includes("fully paid")?"請求書の入金状態が変わりました。":"変換先を作成できませんでした。",409);}
});

app.post("/api/v1/documents/:id/revise",async(c)=>{
  const actor=c.get("actor");if(!requireAdmin(actor))return errorResponse("FORBIDDEN","管理者のみ改訂書類を作成できます。",403);
  const sourceId=c.req.param("id");const schema=z.object({reason:z.string().trim().min(3).max(500)});const parsed=schema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse("VALIDATION_ERROR","改訂理由を入力してください。",422);
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const hash=await requestFingerprint(parsed.data);const operation=`revise:${sourceId}`;const replay=await replayIdempotency(c,operation,key,hash);if(replay)return replay;
  const source=await revisionFor(c,sourceId,true);if(!source||source.row.state!=="ISSUED")return errorResponse("REVISION_SOURCE_INVALID","発行済みの帳票のみ改訂できます。",409);
  if(source.row.type==="INV"){
    const payments=await c.env.DB.prepare("SELECT 1 FROM payments WHERE organization_id=? AND invoice_document_id=? AND voided_at IS NULL LIMIT 1").bind(actor.organizationId,sourceId).first();
    const receipt=await c.env.DB.prepare("SELECT 1 FROM document_relations WHERE organization_id=? AND source_revision_id=? AND kind='RECEIPT_FOR' LIMIT 1").bind(actor.organizationId,source.row.id).first();
    if(payments||receipt)return errorResponse("REVISION_BLOCKED","入金または領収書がある請求書は改訂できません。",409);
  }
  const latest=await c.env.DB.prepare("SELECT COALESCE(MAX(revision),0) revision FROM document_revisions WHERE organization_id=? AND document_id=?").bind(actor.organizationId,sourceId).first<{revision:number}>();
  const data=viewModel(source).data;
  try{
    const response=await insertDraft(c,data,{documentId:sourceId,revision:Number(latest?.revision??0)+1,previousRevisionId:source.row.id,snapshot:source.row,correctionReason:parsed.data.reason,action:"DOCUMENT_REVISION_CREATED",idempotency:{operation,key,requestHash:hash}});
    return c.json({data:response},201);
  }catch(error){const race=await replayIdempotency(c,operation,key,hash);if(race)return race;return errorResponse("REVISION_CONFLICT","改訂下書きを作成できませんでした。最新の帳票状態を確認してください。",409);}
});

app.get("/api/v1/documents/:id/relations",async(c)=>{
  const actor=c.get("actor");const docId=c.req.param("id");
  const exists=await c.env.DB.prepare("SELECT 1 FROM documents WHERE organization_id=? AND id=?").bind(actor.organizationId,docId).first();if(!exists)return errorResponse("NOT_FOUND","帳票が見つかりません。",404);
  const rows=await c.env.DB.prepare(`SELECT rel.kind,rel.created_at,
      CASE WHEN target.id=? THEN source.id ELSE target.id END related_document_id,
      CASE WHEN target.id=? THEN target.id ELSE source.id END related_revision_document_id,
      CASE WHEN target.id=? THEN source.type ELSE target.type END type,
      CASE WHEN target.id=? THEN source.number ELSE target.number END number,
      CASE WHEN target.id=? THEN r.subject ELSE tr.subject END subject,
      CASE WHEN target.id=? THEN r.issue_date ELSE tr.issue_date END issue_date
    FROM document_relations rel JOIN document_revisions r ON r.organization_id=rel.organization_id AND r.id=rel.source_revision_id
    JOIN documents source ON source.organization_id=rel.organization_id AND source.id=r.document_id
    JOIN documents target ON target.organization_id=rel.organization_id AND target.id=rel.target_document_id
    JOIN document_revisions tr ON tr.organization_id=target.organization_id AND tr.id=COALESCE(target.current_issued_revision_id,target.active_draft_revision_id)
    WHERE rel.organization_id=? AND (target.id=? OR source.id=?) ORDER BY rel.created_at,rel.id`).bind(docId,docId,docId,docId,docId,docId,actor.organizationId,docId,docId).all();
  return c.json({data:rows.results});
});

app.get("/api/v1/documents/:id/revisions",async(c)=>{
  const actor=c.get("actor");const docId=c.req.param("id");
  const rows=await c.env.DB.prepare(`SELECT r.id,r.revision,r.state,r.issue_date,r.subject,r.total_yen,r.issued_at,r.created_at,r.previous_revision_id,json_extract(r.type_fields_json,'$.correctionReason') reason
    FROM document_revisions r JOIN documents d ON d.organization_id=r.organization_id AND d.id=r.document_id WHERE r.organization_id=? AND d.id=? ORDER BY r.revision DESC`).bind(actor.organizationId,docId).all();
  if(!rows.results.length)return errorResponse("NOT_FOUND","帳票が見つかりません。",404);
  return c.json({data:rows.results});
});

app.get("/api/v1/documents/:id/audit",async(c)=>{
  const actor=c.get("actor");const docId=c.req.param("id");
  const rows=await c.env.DB.prepare("SELECT action,revision_id,occurred_at,details_json FROM audit_logs WHERE organization_id=? AND entity_type='DOCUMENT' AND entity_id=? ORDER BY occurred_at,id LIMIT 100").bind(actor.organizationId,docId).all();
  return c.json({data:rows.results});
});

app.patch("/api/v1/documents/:id", async (c) => {
  const actor = c.get("actor"); const parsed = DraftDocumentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "帳票の入力内容を確認してください。", 422);
  const version = Number(c.req.header("If-Match"));
  if (!Number.isSafeInteger(version) || version < 1) return errorResponse("PRECONDITION_REQUIRED", "画面を再読み込みしてから保存してください。", 409);
  const docId = c.req.param("id"); const record = await revisionFor(c,docId);
  if (!record || record.row.state !== "DRAFT") return errorResponse("DOCUMENT_LOCKED", "発行済みの帳票は直接編集できません。", 409);
  if (record.row.version !== version) return errorResponse("VERSION_CONFLICT", "別の変更が保存されています。最新の内容を読み込み直してください。", 409);
  const data = parsed.data; const timestamp = now(); const revisionId = record.row.id; const nextVersion = version + 1;
  const tax = calculateDocumentTax(data.lines, {mode:data.taxMode,lineRounding:record.row.line_rounding,taxRounding:record.row.tax_rounding});
  const recipient = JSON.stringify({name:data.recipientName,postalCode:data.recipientPostalCode,address:data.recipientAddress,building:data.recipientBuilding,phone:data.recipientPhone,department:data.department,contact:data.contactName,override:data.recipientOverride});
  const previousTypeFields=JSON.parse(record.row.type_fields_json) as {correctionReason?:string};
  const typeFields={validUntil:data.validUntil ?? null,showAmounts:data.showAmounts,deliveryDate:data.deliveryDate,requestedDeliveryDate:data.requestedDeliveryDate,acceptedDate:data.acceptedDate,deliveryPlace:data.deliveryPlace,paymentTerms:data.paymentTerms,purchaseOrderNumber:data.purchaseOrderNumber,quotationReference:data.quotationReference,purpose:data.purpose,paymentMethod:data.paymentMethod,correctionReason:previousTypeFields.correctionReason};
  const update = c.env.DB.prepare(`UPDATE document_revisions SET version=?,counterparty_id=?,recipient_snapshot_json=?,recipient_search_name=?,issue_date=?,transaction_date=?,period_start=?,period_end=?,due_date=?,subject=?,tax_mode=?,subtotal_yen=?,tax_yen=?,total_yen=?,tax_summary_json=?,notes=?,type_fields_json=?,updated_at=?
    WHERE organization_id=? AND document_id=? AND id=? AND state='DRAFT' AND version=?`)
    .bind(nextVersion,data.counterpartyId||null,recipient,data.recipientName,data.issueDate,data.transactionDate??null,data.periodStart??null,data.periodEnd??null,data.dueDate ?? null,data.subject,data.taxMode,tax.subtotalYen,tax.taxYen,tax.totalYen,JSON.stringify(tax.groups),data.notes,JSON.stringify(typeFields),timestamp,actor.organizationId,docId,revisionId,version);
  const statements: D1PreparedStatement[] = [update,
    c.env.DB.prepare(`UPDATE documents SET counterparty_id=? WHERE organization_id=? AND id=? AND active_draft_revision_id=? AND EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND organization_id=? AND version=? AND state='DRAFT')`).bind(data.counterpartyId||null,actor.organizationId,docId,revisionId,revisionId,actor.organizationId,nextVersion),
    c.env.DB.prepare(`DELETE FROM document_items WHERE organization_id=? AND revision_id=? AND EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND organization_id=? AND version=?)`).bind(actor.organizationId,revisionId,revisionId,actor.organizationId,nextVersion),
  ];
  for (const [position,line] of data.lines.entries()) statements.push(c.env.DB.prepare(`INSERT INTO document_items(id,organization_id,revision_id,position,description,quantity_decimal,unit,unit_price_decimal,tax_class,line_amount_yen)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND organization_id=? AND version=? AND state='DRAFT')`)
    .bind(line.id || id(),actor.organizationId,revisionId,position,line.description,line.quantity,line.unit,line.unitPrice,line.taxClass,tax.lines[position].amountYen,revisionId,actor.organizationId,nextVersion));
  statements.push(c.env.DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND organization_id=? AND version=?)`)
    .bind(id(),actor.organizationId,actor.id,"DOCUMENT_DRAFT_UPDATED","DOCUMENT",docId,revisionId,timestamp,c.get("requestId"),JSON.stringify({version:nextVersion}),revisionId,actor.organizationId,nextVersion));
  statements.splice(1,0,c.env.DB.prepare(`INSERT INTO write_guard_failures(reason)
    SELECT 'stale draft version' WHERE changes()<>1`));
  let results: Awaited<ReturnType<typeof c.env.DB.batch>>;
  try {
    results=await c.env.DB.batch(statements);
  } catch(error) {
    if(String(error).includes("stale draft version"))return errorResponse("VERSION_CONFLICT","別の変更が保存されています。最新の内容を読み込み直してください。",409);
    return errorResponse("SAVE_FAILED","保存できませんでした。",409);
  }
  if (!results[0].success) return errorResponse("SAVE_FAILED", "保存できませんでした。", 409);
  if ((results[0].meta.changes ?? 0) !== 1) return errorResponse("VERSION_CONFLICT", "別の変更が保存されています。最新の内容を読み込み直してください。", 409);
  return c.json({ data: { saved:true,version:nextVersion,totalYen:tax.totalYen } });
});

app.post("/api/v1/documents/:id/issue",async(c)=>{
  const actor=c.get("actor");const docId=c.req.param("id");
  let record=await revisionFor(c,docId);
  if(!record)return errorResponse("NOT_FOUND","帳票が見つかりません。",404);
  if(record.row.revision>0&&actor.role!=="ADMIN")return errorResponse("FORBIDDEN","改訂書類の発行は管理者のみ実行できます。",403);
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const operation=`issue:${docId}:${record.row.id}`;const requestHash=await requestFingerprint({documentId:docId,revisionId:record.row.id});
  let idempotency=await c.env.DB.prepare("SELECT request_hash,response_json,state FROM idempotency_requests WHERE organization_id=? AND actor_id=? AND operation=? AND key=?")
    .bind(actor.organizationId,actor.id,operation,key).first<{request_hash:string;response_json:string|null;state:string}>();
  if(idempotency&&idempotency.request_hash!==requestHash)return errorResponse("IDEMPOTENCY_CONFLICT","同じリクエストキーが別の発行処理に使われています。",409);
  if(idempotency?.state==="COMPLETED"&&idempotency.response_json)return c.json({data:JSON.parse(idempotency.response_json)});
  if(record.row.state==="ISSUED"){
    const response={issued:true,number:record.row.number,pdfUrl:`/api/v1/documents/${docId}/revisions/${record.row.revision}/pdf`};const timestamp=now();
    await c.env.DB.prepare(`INSERT INTO idempotency_requests(organization_id,actor_id,operation,key,request_hash,resource_id,response_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(organization_id,actor_id,operation,key) DO UPDATE SET resource_id=excluded.resource_id,response_json=excluded.response_json,state='COMPLETED'
      WHERE idempotency_requests.request_hash=excluded.request_hash`).bind(actor.organizationId,actor.id,operation,key,requestHash,docId,JSON.stringify(response),"COMPLETED",timestamp).run();
    return c.json({data:response});
  }
  let job=await c.env.DB.prepare("SELECT id,state,snapshot_hash,object_key,attempt_count,lease_expires_at FROM issue_jobs WHERE organization_id=? AND revision_id=?").bind(actor.organizationId,record.row.id).first<{id:string;state:string;snapshot_hash:string;object_key:string;attempt_count:number;lease_expires_at:string|null}>();
  if(record.row.state!=="DRAFT"&&record.row.state!=="ISSUING")return errorResponse("DOCUMENT_LOCKED","この帳票は発行できません。",409);
  if(record.row.state==="DRAFT"){
    const data=viewModel(record).data;
    if(!data.recipientName.trim()&&!data.recipientOverride.trim())return errorResponse("ISSUE_VALIDATION","宛名を入力してください。",422);
    if(!record.row.subject.trim())return errorResponse("ISSUE_VALIDATION","件名を入力してください。",422);
    if(data.lines.some((line)=>!line.description.trim()||!line.unit.trim()))return errorResponse("ISSUE_VALIDATION","すべての明細に品名と単位を入力してください。",422);
    if(record.row.type==="QT"&&!data.validUntil)return errorResponse("ISSUE_VALIDATION","見積有効期限を入力してください。",422);
    if(record.row.type==="DN"&&!data.deliveryDate)return errorResponse("ISSUE_VALIDATION","納品日を入力してください。",422);
    if(record.row.type==="INV"&&!record.row.due_date)return errorResponse("ISSUE_VALIDATION","請求書の支払期限を入力してください。",422);
    if(record.row.type==="RC"&&!data.purpose.trim())return errorResponse("ISSUE_VALIDATION","領収書の但し書きを入力してください。",422);
    if(record.row.type==="RC"){
      const receiptLink=await c.env.DB.prepare("SELECT 1 FROM document_relations WHERE organization_id=? AND target_document_id=? AND kind='RECEIPT_FOR' LIMIT 1")
        .bind(actor.organizationId,docId).first();
      if(receiptLink){
      const claim=await c.env.DB.prepare(`SELECT invoice.total_yen,invoice.tax_summary_json,invoice.recipient_snapshot_json,
        COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL),0) paid_yen,
        (SELECT MAX(p.payment_date) FROM payments p WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL) latest_payment_date,
        CASE WHEN (SELECT COUNT(DISTINCT p.method) FROM payments p WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL)=1
          THEN (SELECT MIN(p.method) FROM payments p WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL)
          ELSE 'OTHER' END payment_method
        FROM document_relations rel
        JOIN document_revisions invoice ON invoice.organization_id=rel.organization_id AND invoice.id=rel.source_revision_id AND invoice.state='ISSUED'
        JOIN documents invoice_document ON invoice_document.organization_id=invoice.organization_id AND invoice_document.id=invoice.document_id
          AND invoice_document.type='INV' AND invoice_document.current_issued_revision_id=invoice.id
        WHERE rel.organization_id=? AND rel.target_document_id=? AND rel.kind='RECEIPT_FOR' LIMIT 1`)
        .bind(actor.organizationId,docId).first<{total_yen:number;tax_summary_json:string;recipient_snapshot_json:string;paid_yen:number;latest_payment_date:string|null;payment_method:string}>();
      const typeFields=JSON.parse(record.row.type_fields_json||"{}") as {paymentMethod?:string};
      if(!claim||claim.total_yen<=0||claim.paid_yen!==claim.total_yen||record.row.total_yen!==claim.total_yen||
        record.row.tax_summary_json!==claim.tax_summary_json||record.row.recipient_snapshot_json!==claim.recipient_snapshot_json||
        record.row.issue_date!==claim.latest_payment_date||typeFields.paymentMethod!==claim.payment_method)
        return errorResponse("RECEIPT_SNAPSHOT_MISMATCH","領収書の金額・宛名・税額・入金情報が請求書と一致しません。請求書から作成し直してください。",409);
      }
    }
    if(record.row.type==="OC"&&!data.acceptedDate)return errorResponse("ISSUE_VALIDATION","受注日を入力してください。",422);
    const expectedCounterpartyRole=record.row.type==="PO"?"supplier":record.row.type==="OC"?"customer":null;
    if(expectedCounterpartyRole&&record.row.counterparty_id){
      const partner=await c.env.DB.prepare("SELECT is_customer,is_supplier FROM counterparties WHERE organization_id=? AND id=? AND active=1")
        .bind(actor.organizationId,record.row.counterparty_id).first<{is_customer:number;is_supplier:number}>();
      const hasRequiredRole=expectedCounterpartyRole==="supplier"?partner?.is_supplier:partner?.is_customer;
      if(!partner||!hasRequiredRole)return errorResponse("COUNTERPARTY_ROLE_MISMATCH",expectedCounterpartyRole==="supplier"?"発注書の宛先は仕入先として登録された取引先を選択してください。":"注文請書の宛先はお客様として登録された取引先を選択してください。",422);
    }
    const settings=await c.env.DB.prepare("SELECT qualified_mode,registration_number FROM organization_settings WHERE organization_id=?").bind(actor.organizationId).first<{qualified_mode:number;registration_number:string|null}>();
    if(record.row.type==="INV"){
      const hasAnyPeriod=!!data.periodStart||!!data.periodEnd;const hasFullPeriod=!!data.periodStart&&!!data.periodEnd;
      if(hasAnyPeriod&&!hasFullPeriod)return errorResponse("ISSUE_VALIDATION","取引期間は開始日と終了日の両方を入力してください。",422);
      if(data.periodStart&&data.periodEnd&&data.periodStart>data.periodEnd)return errorResponse("ISSUE_VALIDATION","取引期間を確認してください。",422);
      if(data.transactionDate&&hasAnyPeriod)return errorResponse("ISSUE_VALIDATION","取引年月日と取引期間のどちらか一方を入力してください。",422);
      if(settings?.qualified_mode){
        if(!settings.registration_number||!/^T\d{13}$/.test(settings.registration_number))return errorResponse("ISSUE_VALIDATION","適格請求書を発行するには有効な登録番号を設定してください。",422);
        if(!data.transactionDate&&!hasFullPeriod)return errorResponse("ISSUE_VALIDATION","適格請求書には取引年月日または取引期間が必要です。",422);
        const invoiceVm=viewModel(record);
        if(!invoiceVm.issuer.legalName.trim()||(!data.recipientName.trim()&&!data.recipientOverride.trim()))return errorResponse("ISSUE_VALIDATION","適格請求書には発行者名と宛名が必要です。",422);
      }
    }
    if(!record.row.issue_date||!/^\d{4}-\d{2}-\d{2}$/.test(record.row.issue_date))return errorResponse("ISSUE_VALIDATION","発行日を確認してください。",422);
    const seqYear=Number(record.row.issue_date.slice(0,4));
    const existingReservation=await c.env.DB.prepare("SELECT formatted_number,year,sequence_value FROM number_reservations WHERE organization_id=? AND document_id=?").bind(actor.organizationId,docId).first<{formatted_number:string;year:number;sequence_value:number}>();
    if(!existingReservation){
      const numberSettings=await c.env.DB.prepare("SELECT pattern FROM numbering_settings WHERE organization_id=? AND type=?").bind(actor.organizationId,record.row.type).first<{pattern:string}>();
      const pattern=numberSettings?.pattern??DEFAULT_NUMBERING[record.row.type];
      const current=await c.env.DB.prepare("SELECT last_value,pattern_snapshot FROM number_sequences WHERE organization_id=? AND type=? AND year=?").bind(actor.organizationId,record.row.type,seqYear).first<{last_value:number;pattern_snapshot:string}>();
      const previous=current?.last_value??0;const previousPattern=current?.pattern_snapshot??pattern;const next=previous+1;
      let number:string;try{number=formatDocumentNumber(pattern,seqYear,next)}catch(e){return errorResponse("NUMBERING_INVALID",e instanceof Error?e.message:"採番設定を確認してください。",422)}
      const timestamp=now();const reservationId=id();const jobId=id();
      const snapshot={id:record.row.id,documentId:docId,type:record.row.type,revision:record.row.revision,number,issueTimestamp:timestamp,data:viewModel(record),snapshotSchemaVersion:1};
      const snapshotHash=await sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
      const objectKey=`organization/${actor.organizationId}/documents/${seqYear}/${docId}/revision-${record.row.revision}.pdf`;
      const statements=await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO number_sequences(organization_id,type,year,last_value,pattern_snapshot) VALUES(?,?,?,0,?) ON CONFLICT(organization_id,type,year) DO NOTHING").bind(actor.organizationId,record.row.type,seqYear,pattern),
        c.env.DB.prepare("UPDATE number_sequences SET last_value=?,pattern_snapshot=? WHERE organization_id=? AND type=? AND year=? AND last_value=? AND pattern_snapshot=?").bind(next,pattern,actor.organizationId,record.row.type,seqYear,previous,previousPattern),
        c.env.DB.prepare("INSERT INTO number_reservations(id,organization_id,document_id,type,year,sequence_value,formatted_number,reserved_at) SELECT ?,?,?,?,?,?,?,? FROM number_sequences WHERE organization_id=? AND type=? AND year=? AND last_value=? AND pattern_snapshot=? AND NOT EXISTS(SELECT 1 FROM number_reservations WHERE organization_id=? AND document_id=?)").bind(reservationId,actor.organizationId,docId,record.row.type,seqYear,next,number,timestamp,actor.organizationId,record.row.type,seqYear,next,pattern,actor.organizationId,docId),
        c.env.DB.prepare("UPDATE documents SET number=?,number_year=?,sequence_value=? WHERE organization_id=? AND id=? AND number IS NULL AND EXISTS(SELECT 1 FROM number_reservations WHERE organization_id=? AND document_id=? AND formatted_number=?)").bind(number,seqYear,next,actor.organizationId,docId,actor.organizationId,docId,number),
        c.env.DB.prepare("UPDATE document_revisions SET state='ISSUING',renderer_version='jds-1',updated_at=? WHERE organization_id=? AND id=? AND state='DRAFT' AND EXISTS(SELECT 1 FROM documents WHERE organization_id=? AND id=? AND number=?)").bind(timestamp,actor.organizationId,record.row.id,actor.organizationId,docId,number),
        c.env.DB.prepare("INSERT INTO issue_jobs(id,organization_id,revision_id,state,snapshot_hash,object_key,created_at,updated_at) SELECT ?,?,?, 'PENDING',?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE organization_id=? AND id=? AND state='ISSUING')").bind(jobId,actor.organizationId,record.row.id,snapshotHash,objectKey,timestamp,timestamp,actor.organizationId,record.row.id),
        c.env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM issue_jobs WHERE id=? AND organization_id=?)").bind(id(),actor.organizationId,actor.id,"DOCUMENT_ISSUE_REQUESTED","DOCUMENT",docId,record.row.id,timestamp,c.get("requestId"),JSON.stringify({number}),jobId,actor.organizationId),
      ]);
      if((statements[1].meta.changes??0)!==1||(statements[2].meta.changes??0)!==1||(statements[4].meta.changes??0)!==1)return errorResponse("ISSUE_CONFLICT","他の操作と競合しました。画面を更新してください。",409);
      job=await c.env.DB.prepare("SELECT id,state,snapshot_hash,object_key,attempt_count,lease_expires_at FROM issue_jobs WHERE organization_id=? AND revision_id=?").bind(actor.organizationId,record.row.id).first();
    }else{
      if(!record.row.number)return errorResponse("ISSUE_CONFLICT","採番情報がありません。管理者に連絡してください。",409);
      const timestamp=now();const jobId=id();const reservationYear=existingReservation.year;
      const snapshot={id:record.row.id,documentId:docId,type:record.row.type,revision:record.row.revision,number:existingReservation.formatted_number,issueTimestamp:timestamp,data:viewModel(record),snapshotSchemaVersion:1};
      const snapshotHash=await sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
      const objectKey=`organization/${actor.organizationId}/documents/${reservationYear}/${docId}/revision-${record.row.revision}.pdf`;
      const prepared=await c.env.DB.batch([
        c.env.DB.prepare("UPDATE document_revisions SET state='ISSUING',renderer_version='jds-1',updated_at=? WHERE organization_id=? AND id=? AND state='DRAFT' AND EXISTS(SELECT 1 FROM documents WHERE organization_id=? AND id=? AND number=?)").bind(timestamp,actor.organizationId,record.row.id,actor.organizationId,docId,existingReservation.formatted_number),
        c.env.DB.prepare("INSERT INTO issue_jobs(id,organization_id,revision_id,state,snapshot_hash,object_key,created_at,updated_at) SELECT ?,?,?, 'PENDING',?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE organization_id=? AND id=? AND state='ISSUING')").bind(jobId,actor.organizationId,record.row.id,snapshotHash,objectKey,timestamp,timestamp,actor.organizationId,record.row.id),
        c.env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM issue_jobs WHERE id=? AND organization_id=?)").bind(id(),actor.organizationId,actor.id,"DOCUMENT_ISSUE_REQUESTED","DOCUMENT",docId,record.row.id,timestamp,c.get("requestId"),JSON.stringify({number:existingReservation.formatted_number,revision:record.row.revision}),jobId,actor.organizationId),
      ]);
      if((prepared[0].meta.changes??0)!==1||(prepared[1].meta.changes??0)!==1)return errorResponse("ISSUE_CONFLICT","改訂書類の発行処理を開始できませんでした。",409);
      job=await c.env.DB.prepare("SELECT id,state,snapshot_hash,object_key,attempt_count,lease_expires_at FROM issue_jobs WHERE organization_id=? AND revision_id=?").bind(actor.organizationId,record.row.id).first();
    }
  }
  await c.env.DB.prepare(`INSERT INTO idempotency_requests(organization_id,actor_id,operation,key,request_hash,resource_id,response_json,state,created_at) VALUES(?,?,?,?,?,?,NULL,'PENDING',?)
    ON CONFLICT(organization_id,actor_id,operation,key) DO UPDATE SET resource_id=excluded.resource_id,response_json=NULL,state='PENDING',created_at=excluded.created_at
    WHERE idempotency_requests.request_hash=excluded.request_hash AND idempotency_requests.state<>'COMPLETED'`)
    .bind(actor.organizationId,actor.id,operation,key,requestHash,docId,now()).run();
  if(!job)return errorResponse("ISSUE_JOB_MISSING","発行処理の状態を確認できません。",409);
  if(job.state==="COMPLETE"){
    const response={issued:true,number:record.row.number,pdfUrl:`/api/v1/documents/${docId}/revisions/${record.row.revision}/pdf`};
    await c.env.DB.prepare("UPDATE idempotency_requests SET response_json=?,state='COMPLETED' WHERE organization_id=? AND actor_id=? AND operation=? AND key=? AND request_hash=?").bind(JSON.stringify(response),actor.organizationId,actor.id,operation,key,requestHash).run();
    return c.json({data:response});
  }
  if(job.state==="RENDERING"&&job.lease_expires_at&&job.lease_expires_at>now())return errorResponse("ISSUE_IN_PROGRESS","発行処理を実行しています。しばらくしてから確認してください。",409);
  const token=id();const timestamp=now();const expires=new Date(Date.now()+90_000).toISOString();
  const claimed=await c.env.DB.prepare("UPDATE issue_jobs SET state='RENDERING',lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE organization_id=? AND id=? AND state IN ('PENDING','FAILED','STORED','RENDERING') AND (lease_expires_at IS NULL OR lease_expires_at<?)")
    .bind(token,expires,timestamp,actor.organizationId,job.id,timestamp).run();
  if((claimed.meta.changes??0)!==1)return errorResponse("ISSUE_IN_PROGRESS","別の発行処理が進行中です。",409);
  try{
    record=await revisionFor(c,docId);if(!record)throw new Error("DOCUMENT_NOT_FOUND");
    const snapshotHash=job.snapshot_hash;let pdfBytes:Uint8Array;let fileHash:string;
    const existing=await c.env.DOCUMENT_ARTIFACTS.get(job.object_key);
    if(existing){
      if(existing.customMetadata?.snapshotHash!==snapshotHash||!existing.customMetadata?.sha256)throw new Error("ARTIFACT_HASH_MISMATCH");
      pdfBytes=new Uint8Array(await existing.arrayBuffer());fileHash=await sha256(pdfBytes);
      if(fileHash!==existing.customMetadata.sha256)throw new Error("ARTIFACT_HASH_MISMATCH");
    }else{
      const rendered=await makePdf(c.env,renderDocumentHtml(viewModel(record)));
      pdfBytes=rendered;fileHash=await sha256(pdfBytes);
      const created=await c.env.DOCUMENT_ARTIFACTS.put(job.object_key,pdfBytes,{onlyIf:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/pdf",cacheControl:"private, no-store"},customMetadata:{sha256:fileHash,snapshotHash,rendererVersion:"jds-1"}});
      if(!created){
        const raced=await c.env.DOCUMENT_ARTIFACTS.get(job.object_key);
        if(!raced||raced.customMetadata?.snapshotHash!==snapshotHash||raced.customMetadata?.sha256!==fileHash)throw new Error("ARTIFACT_HASH_MISMATCH");
        pdfBytes=new Uint8Array(await raced.arrayBuffer());fileHash=await sha256(pdfBytes);
      }
    }
    const storedAt=now();
    await c.env.DB.prepare("UPDATE issue_jobs SET state='STORED',lease_expires_at=?,updated_at=? WHERE organization_id=? AND id=? AND lease_token=?").bind(expires,storedAt,actor.organizationId,job.id,token).run();
    const fileId=id();
    const completed=await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO document_files(id,organization_id,revision_id,kind,object_key,sha256,bytes,mime,generated_at,renderer_version) SELECT ?,?,?,?,?,?,?,'application/pdf',?,'jds-1' WHERE EXISTS(SELECT 1 FROM issue_jobs WHERE id=? AND organization_id=? AND state='STORED' AND lease_token=?) ON CONFLICT(organization_id,revision_id,kind) DO NOTHING").bind(fileId,actor.organizationId,record.row.id,"ISSUED_PDF",job.object_key,fileHash,pdfBytes.byteLength,storedAt,job.id,actor.organizationId,token),
      c.env.DB.prepare("UPDATE document_revisions SET state='ISSUED',issued_at=?,updated_at=? WHERE organization_id=? AND id=? AND state='ISSUING' AND EXISTS(SELECT 1 FROM issue_jobs WHERE id=? AND organization_id=? AND state='STORED' AND lease_token=?)").bind(storedAt,storedAt,actor.organizationId,record.row.id,job.id,actor.organizationId,token),
      c.env.DB.prepare("UPDATE documents SET current_issued_revision_id=?,active_draft_revision_id=NULL WHERE organization_id=? AND id=? AND active_draft_revision_id=? AND EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND state='ISSUED')").bind(record.row.id,actor.organizationId,docId,record.row.id,record.row.id),
      c.env.DB.prepare("UPDATE issue_jobs SET state='COMPLETE',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE organization_id=? AND id=? AND state='STORED' AND lease_token=?").bind(storedAt,actor.organizationId,job.id,token),
      c.env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM issue_jobs WHERE id=? AND organization_id=? AND state='COMPLETE')").bind(id(),actor.organizationId,actor.id,"DOCUMENT_ISSUED","DOCUMENT",docId,record.row.id,storedAt,c.get("requestId"),JSON.stringify({number:record.row.number,sha256:fileHash,bytes:pdfBytes.byteLength}),job.id,actor.organizationId),
      c.env.DB.prepare("UPDATE idempotency_requests SET response_json=?,state='COMPLETED' WHERE organization_id=? AND actor_id=? AND operation=? AND key=? AND request_hash=? AND EXISTS(SELECT 1 FROM issue_jobs WHERE organization_id=? AND id=? AND state='COMPLETE')").bind(JSON.stringify({issued:true,number:record.row.number,sha256:fileHash,pdfUrl:`/api/v1/documents/${docId}/revisions/${record.row.revision}/pdf`}),actor.organizationId,actor.id,operation,key,requestHash,actor.organizationId,job.id),
    ]);
    if((completed[0].meta.changes??0)!==1||(completed[1].meta.changes??0)!==1||(completed[2].meta.changes??0)!==1||(completed[3].meta.changes??0)!==1||(completed[5].meta.changes??0)!==1)throw new Error("ISSUE_FINALIZE_CONFLICT");
    return c.json({data:{issued:true,number:record.row.number,sha256:fileHash,pdfUrl:`/api/v1/documents/${docId}/revisions/${record.row.revision}/pdf`}});
  }catch(error){
    const code=error instanceof Error?error.message:"PDF_RENDER_FAILED";
    console.error("document_issue_failed",{requestId:c.get("requestId"),jobId:job.id,code});
    await c.env.DB.prepare("UPDATE issue_jobs SET state='FAILED',lease_token=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? WHERE organization_id=? AND id=? AND lease_token=? AND state<>'COMPLETE'").bind(code.slice(0,80),now(),actor.organizationId,job.id,token).run().catch(()=>undefined);
    await c.env.DB.prepare("UPDATE idempotency_requests SET response_json=NULL,state='FAILED' WHERE organization_id=? AND actor_id=? AND operation=? AND key=? AND request_hash=?").bind(actor.organizationId,actor.id,operation,key,requestHash).run().catch(()=>undefined);
    return errorResponse("ISSUE_FAILED",code==="ARTIFACT_HASH_MISMATCH"?"保存済みのPDFを検証できません。管理者に連絡してください。":"PDFを発行できませんでした。内容を確認して再試行してください。",500);
  }
});

app.post("/api/v1/payments/:id/corrections",async(c)=>{
  const actor=c.get("actor");if(!requireAdmin(actor))return errorResponse("FORBIDDEN","管理者のみ入金を訂正できます。",403);
  const paymentId=c.req.param("id");
  const schema=z.object({reason:z.string().trim().min(3).max(500),replacement:z.object({paymentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),amountYen:z.number().int().positive().max(2_000_000_000),method:z.enum(["BANK_TRANSFER","CASH","CARD","OTHER"]),note:z.string().max(1000).default("")})});
  const parsed=schema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return errorResponse("VALIDATION_ERROR","訂正理由と修正後の入金内容を確認してください。",422);
  const key=idempotencyKey(c);if(!key)return errorResponse("IDEMPOTENCY_KEY_REQUIRED","リクエストキーを指定してください。",422);
  const hash=await requestFingerprint(parsed.data);const operation=`payment-correction:${paymentId}`;const replay=await replayIdempotency(c,operation,key,hash);if(replay)return replay;
  const original=await c.env.DB.prepare("SELECT invoice_document_id,invoice_revision_id,voided_at FROM payments WHERE organization_id=? AND id=?").bind(actor.organizationId,paymentId).first<{invoice_document_id:string;invoice_revision_id:string;voided_at:string|null}>();
  if(!original||original.voided_at)return errorResponse("PAYMENT_NOT_CORRECTABLE","入金記録が見つからないか、すでに訂正されています。",409);
  const effective=await revisionFor(c,original.invoice_document_id,true);if(!effective||effective.row.id!==original.invoice_revision_id)return errorResponse("PAYMENT_NOT_EFFECTIVE","現在有効な請求書の入金のみ訂正できます。",409);
  const receipt=await c.env.DB.prepare("SELECT 1 FROM document_relations WHERE organization_id=? AND source_revision_id=? AND kind='RECEIPT_FOR' LIMIT 1").bind(actor.organizationId,effective.row.id).first();
  if(receipt)return errorResponse("PAYMENT_CORRECTION_BLOCKED","発行済みまたは作成中の領収書がある入金は訂正できません。",409);
  const date=parsed.data.replacement.paymentDate;const validDate=new Date(`${date}T00:00:00Z`);
  if(!Number.isFinite(validDate.getTime())||validDate.toISOString().slice(0,10)!==date)return errorResponse("VALIDATION_ERROR","入金日を確認してください。",422);
  const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});if(date>today)return errorResponse("VALIDATION_ERROR","未来の日付は登録できません。",422);
  if(date<effective.row.issue_date&&(!parsed.data.replacement.note.trim()))return errorResponse("PREPAYMENT_CONFIRMATION_REQUIRED","請求日より前の入金には備考が必要です。",422);
  const replacementId=id();const timestamp=now();const response={id:replacementId,replacesPaymentId:paymentId,invoiceDocumentId:original.invoice_document_id,paymentDate:date,amountYen:parsed.data.replacement.amountYen,method:parsed.data.replacement.method,note:parsed.data.replacement.note};
  try{
    const results=await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO idempotency_requests(organization_id,actor_id,operation,key,request_hash,resource_id,response_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(actor.organizationId,actor.id,operation,key,hash,replacementId,JSON.stringify(response),"COMPLETED",timestamp),
      c.env.DB.prepare("UPDATE payments SET voided_at=?,voided_by=?,correction_reason=? WHERE organization_id=? AND id=? AND voided_at IS NULL").bind(timestamp,actor.id,parsed.data.reason,actor.organizationId,paymentId),
      c.env.DB.prepare("INSERT INTO payments(id,organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,note,created_by,created_at,replaces_payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(replacementId,actor.organizationId,original.invoice_document_id,original.invoice_revision_id,date,parsed.data.replacement.amountYen,parsed.data.replacement.method,parsed.data.replacement.note,actor.id,timestamp,paymentId),
      c.env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE id=? AND organization_id=?)").bind(id(),actor.organizationId,actor.id,"PAYMENT_CORRECTED","PAYMENT",replacementId,original.invoice_revision_id,timestamp,c.get("requestId"),JSON.stringify({replacesPaymentId:paymentId,reason:parsed.data.reason,amountYen:parsed.data.replacement.amountYen}),replacementId,actor.organizationId),
    ]);
    if((results[1].meta.changes??0)!==1||(results[2].meta.changes??0)!==1)return errorResponse("PAYMENT_CONFLICT","入金訂正に失敗しました。残額を確認してください。",409);
    return c.json({data:response},201);
  }catch(error){const race=await replayIdempotency(c,operation,key,hash);if(race)return race;return errorResponse("PAYMENT_CORRECTION_CONFLICT","入金を訂正できませんでした。請求残額を確認してください。",409);}
});

app.post("/api/v1/documents/:id/mark-sent",async(c)=>{
  const actor=c.get("actor");const docId=c.req.param("id");const record=await revisionFor(c,docId,true);
  if(!record||record.row.state!=="ISSUED")return errorResponse("DOCUMENT_NOT_ISSUED","発行済みの帳票のみ送付済みにできます。",409);
  const timestamp=now();const results=await c.env.DB.batch([
    c.env.DB.prepare("UPDATE document_revisions SET sent_at=COALESCE(sent_at,?),updated_at=? WHERE organization_id=? AND id=? AND state='ISSUED'").bind(timestamp,timestamp,actor.organizationId,record.row.id),
    c.env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,revision_id,occurred_at,request_id,details_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE organization_id=? AND id=? AND sent_at IS NOT NULL)").bind(id(),actor.organizationId,actor.id,"DOCUMENT_MARKED_SENT","DOCUMENT",docId,record.row.id,timestamp,c.get("requestId"),"{}",actor.organizationId,record.row.id),
  ]);
  if((results[0].meta.changes??0)!==1)return errorResponse("SAVE_FAILED","送付状態を保存できませんでした。",409);
  return c.json({data:{sent:true,sentAt:timestamp}});
});

app.post("/api/v1/documents/:id/preview", async (c) => {
  const record = await revisionFor(c,c.req.param("id"));
  if (!record) return errorResponse("NOT_FOUND", "帳票が見つかりません。", 404);
  try {
    const html = renderDocumentHtml(viewModel(record));
    const pdf=await makePdf(c.env,html);
    return new Response(copyBuffer(pdf),{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename*=UTF-8''document-preview.pdf","Cache-Control":"private, no-store"}});
  } catch (error) {
    console.error("pdf_preview_failed",{requestId:c.get("requestId"),error:String(error)});
    return errorResponse("PDF_RENDER_FAILED","PDFを生成できませんでした。入力を保存してからもう一度お試しください。",500);
  }
});

app.get("/api/v1/documents/:id/revisions/:revision/pdf",async(c)=>{
  const actor=c.get("actor");const revision=Number(c.req.param("revision"));
  if(!Number.isSafeInteger(revision)||revision<0)return errorResponse("NOT_FOUND","PDFが見つかりません。",404);
  const file=await c.env.DB.prepare(`SELECT f.object_key,f.sha256,d.type,d.number FROM document_files f JOIN document_revisions r ON r.organization_id=f.organization_id AND r.id=f.revision_id JOIN documents d ON d.organization_id=r.organization_id AND d.id=r.document_id WHERE f.organization_id=? AND d.id=? AND r.revision=? AND r.state='ISSUED' AND f.kind='ISSUED_PDF'`).bind(actor.organizationId,c.req.param("id"),revision).first<{object_key:string;sha256:string;type:string;number:string}>();
  if(!file)return errorResponse("NOT_FOUND","PDFが見つかりません。",404);
  const object=await c.env.DOCUMENT_ARTIFACTS.get(file.object_key);if(!object||object.customMetadata?.sha256!==file.sha256)return errorResponse("ARTIFACT_UNAVAILABLE","保存されたPDFを確認できません。管理者に連絡してください。",500);
  const filename=`${file.number||file.type}_rev${revision}.pdf`;
  return new Response(object.body,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(filename)}`,"Cache-Control":"private, no-store","Content-Length":String(object.size),"X-Content-Type-Options":"nosniff"}});
});

app.get("/api/v1/sales/summary", async (c) => {
  const month = c.req.query("month") ?? new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"}).slice(0,7);
  if (!/^\d{4}-\d{2}$/.test(month)) return errorResponse("VALIDATION_ERROR","対象月を確認してください。",422);
  const start = `${month}-01`; const end = new Date(`${month}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1);
  const until = end.toISOString().slice(0,10);
  const row = await c.env.DB.prepare(`SELECT COALESCE(SUM(r.subtotal_yen),0) sales_yen,COALESCE(SUM(r.total_yen),0) invoiced_yen,
    COALESCE(SUM((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL)),0) paid_yen,
    COALESCE(SUM(CASE WHEN r.due_date < ? AND (r.total_yen-COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0))>0 THEN 1 ELSE 0 END),0) overdue_count
    FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id
    WHERE d.organization_id=? AND d.type='INV' AND r.state='ISSUED' AND r.issue_date>=? AND r.issue_date<?`)
    .bind(new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"}),c.get("actor").organizationId,start,until).first<Record<string,number>>();
  const sales = row ?? {sales_yen:0,invoiced_yen:0,paid_yen:0,overdue_count:0};
  return c.json({ data: { month,salesYen:sales.sales_yen,invoicedYen:sales.invoiced_yen,paidYen:sales.paid_yen,outstandingYen:sales.invoiced_yen-sales.paid_yen,overdueCount:sales.overdue_count,definition:"請求日を基準とした発行済み請求書の税抜合計" } });
});

app.get("/api/v1/sales/monthly",async(c)=>{
  const endMonth=c.req.query("endMonth")??new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"});
  const count=Math.min(12,Math.max(1,Number(c.req.query("count")??6)));
  if(!/^\d{4}-\d{2}$/.test(endMonth)||!Number.isInteger(count))return errorResponse("VALIDATION_ERROR","対象期間を確認してください。",422);
  const end=new Date(`${endMonth}-01T00:00:00Z`);const start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-(count-1),1));
  const rows=await c.env.DB.prepare(`SELECT substr(r.issue_date,1,7) month,COALESCE(SUM(r.subtotal_yen),0) sales_yen FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id
    WHERE d.organization_id=? AND d.type='INV' AND r.state='ISSUED' AND r.issue_date>=? AND r.issue_date<? GROUP BY substr(r.issue_date,1,7) ORDER BY month`)
    .bind(c.get("actor").organizationId,start.toISOString().slice(0,10),new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,1)).toISOString().slice(0,10)).all<{month:string;sales_yen:number}>();
  const values=new Map(rows.results.map(row=>[row.month,row.sales_yen]));
  return c.json({data:Array.from({length:count},(_,i)=>{const date=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+i,1));const month=date.toISOString().slice(0,7);return{month,salesYen:values.get(month)??0}})});
});

app.get("/api/v1/sales/counterparties",async(c)=>{
  const month=c.req.query("month")??new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit"});
  if(!/^\d{4}-\d{2}$/.test(month))return errorResponse("VALIDATION_ERROR","対象月を確認してください。",422);
  const from=`${month}-01`;const end=new Date(`${from}T00:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1);
  const rows=await c.env.DB.prepare(`SELECT d.counterparty_id,COALESCE(c.name,r.recipient_search_name,'取引先未設定') counterparty_name,COUNT(*) invoice_count,COALESCE(SUM(r.subtotal_yen),0) sales_yen,COALESCE(SUM(r.total_yen),0) invoiced_yen
    FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id LEFT JOIN counterparties c ON c.organization_id=d.organization_id AND c.id=d.counterparty_id
    WHERE d.organization_id=? AND d.type='INV' AND r.state='ISSUED' AND r.issue_date>=? AND r.issue_date<? GROUP BY COALESCE(d.counterparty_id,r.recipient_search_name),COALESCE(c.name,r.recipient_search_name,'取引先未設定') ORDER BY sales_yen DESC,counterparty_name LIMIT 100`)
    .bind(c.get("actor").organizationId,from,end.toISOString().slice(0,10)).all();
  return c.json({data:rows.results});
});

app.get("/api/v1/sales/overdue",async(c)=>{
  const today=new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  const rows=await c.env.DB.prepare(`SELECT d.id,d.number,r.subject,r.recipient_search_name,r.due_date,r.total_yen,r.total_yen-COALESCE(SUM(p.amount_yen),0) outstanding_yen
    FROM documents d JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id LEFT JOIN payments p ON p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL
    WHERE d.organization_id=? AND d.type='INV' AND r.state='ISSUED' AND r.due_date<? GROUP BY d.id,r.id HAVING outstanding_yen>0 ORDER BY r.due_date ASC LIMIT 20`).bind(c.get("actor").organizationId,today).all();
  return c.json({data:rows.results});
});

app.get("/api/v1/health", (c) => c.json({data:{status:"ok",runtime:"cloudflare-workers"}}));
app.notFound((c) => c.req.path.startsWith("/api/") ? errorResponse("NOT_FOUND","APIが見つかりません。",404) : c.env.ASSETS.fetch(c.req.raw));
app.onError((error,c) => {
  console.error("request_failed",{requestId:c.get("requestId"),error:String(error)});
  return errorResponse("INTERNAL_ERROR","処理に失敗しました。",500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const cutoff = new Date(Date.now()-5*60_000).toISOString();
    await env.DB.prepare(`UPDATE issue_jobs SET state='PENDING',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE state='RENDERING' AND lease_expires_at<?`).bind(now(),now(),cutoff).run();
  },
};
