import type { Hono } from "hono";
import { z } from "zod";
import { BankAccountSchema, DecimalInputSchema, DocumentDefaultsSchema, DOCUMENT_TYPES } from "../domain/document";
import { formatDocumentNumber } from "../domain/numbering";
import { auditStatement, errorResponse, id, now, requireAdmin, type AppEnv, type Env } from "./shared";

const MAX_ASSET_BYTES = 1_048_576;
const ASSET_KINDS = { logo: "LOGO", seal: "SEAL" } as const;

const DocumentSettingsInput = z.object({
  default_tax_mode: z.enum(["exclusive", "inclusive"]),
  tax_rounding: z.enum(["floor", "half-up", "ceil"]),
  line_rounding: z.enum(["floor", "half-up", "ceil"]),
  theme: z.enum(["standard", "modern"]),
  accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  quotation_title: z.enum(["御見積書", "見積書"]),
  purchase_order_title: z.enum(["発注書", "注文書"]),
  delivery_show_amounts: z.boolean(),
  numbering: z.record(z.enum(DOCUMENT_TYPES), z.string().trim().min(1).max(40)),
  defaults: DocumentDefaultsSchema,
});
const UserInput = z.object({ email: z.string().trim().toLowerCase().email().max(200), displayName: z.string().trim().min(1).max(100), role: z.enum(["ADMIN", "MEMBER"]) });
const UserPatch = z.object({ displayName: z.string().trim().min(1).max(100).optional(), role: z.enum(["ADMIN", "MEMBER"]).optional(), active: z.boolean().optional() });
const CounterpartyPatch = z.object({
  name: z.string().trim().min(1).max(200), kana: z.string().max(200).default(""),
  isCustomer: z.boolean(), isSupplier: z.boolean(),
  postalCode: z.string().max(20).default(""), prefecture: z.string().max(30).default(""),
  address: z.string().max(300).default(""), building: z.string().max(200).default(""),
  phone: z.string().max(40).default(""), email: z.string().max(200).default(""), notes: z.string().max(2000).default(""),
}).refine((value) => value.isCustomer || value.isSupplier);
const ProductPatch = z.object({
  code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200), description: z.string().max(300).default(""),
  unit: z.string().trim().min(1).max(20), unitPrice: DecimalInputSchema,
  taxClass: z.enum(["STANDARD_10", "REDUCED_8", "NON_TAXABLE", "OUT_OF_SCOPE", "EXEMPT"]),
});

function imageType(bytes: Uint8Array): { mime: "image/png" | "image/jpeg"; extension: string } | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", extension: "png" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  return null;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Loads a stored logo/seal as a data URL so the PDF renderer needs no authenticated fetch. */
export async function brandAssetDataUrl(env: Env, organizationId: string, assetId: string): Promise<string | undefined> {
  const asset = await env.DB.prepare("SELECT object_key,mime FROM brand_assets WHERE organization_id=? AND id=?").bind(organizationId, assetId).first<{ object_key: string; mime: string }>();
  if (!asset) return undefined;
  const object = await env.BRAND_ASSETS.get(asset.object_key);
  if (!object) return undefined;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${asset.mime};base64,${btoa(binary)}`;
}

export function registerSettingsRoutes(app: Hono<AppEnv>) {
  app.put("/api/v1/settings/documents", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
    const parsed = DocumentSettingsInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "帳票設定の入力内容を確認してください。", 422);
    const d = parsed.data; const timestamp = now();
    for (const type of DOCUMENT_TYPES) {
      const pattern = d.numbering[type];
      if (!pattern) return errorResponse("VALIDATION_ERROR", "すべての帳票の採番パターンを入力してください。", 422);
      try { formatDocumentNumber(pattern, 2026, 1); }
      catch (error) { return errorResponse("NUMBERING_INVALID", `${type}：${error instanceof Error ? error.message : "採番パターンを確認してください。"}`, 422); }
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE organization_settings SET default_tax_mode=?,tax_rounding=?,line_rounding=?,theme=?,accent_color=?,quotation_title=?,purchase_order_title=?,delivery_show_amounts=?,payment_terms_json=?,version=version+1,updated_at=? WHERE organization_id=?`)
        .bind(d.default_tax_mode, d.tax_rounding, d.line_rounding, d.theme, d.accent_color, d.quotation_title, d.purchase_order_title, Number(d.delivery_show_amounts), JSON.stringify(d.defaults), timestamp, actor.organizationId),
      ...DOCUMENT_TYPES.map((type) => c.env.DB.prepare(`INSERT INTO numbering_settings(organization_id,type,pattern,updated_at) VALUES(?,?,?,?) ON CONFLICT(organization_id,type) DO UPDATE SET pattern=excluded.pattern,updated_at=excluded.updated_at`)
        .bind(actor.organizationId, type, d.numbering[type]!, timestamp)),
      auditStatement(c.env.DB, actor, c.get("requestId"), "DOCUMENT_SETTINGS_UPDATED", "ORGANIZATION", actor.organizationId, { numbering: d.numbering, theme: d.theme }),
    ]);
    return c.json({ data: { saved: true } });
  });

  app.put("/api/v1/settings/bank", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
    const parsed = BankAccountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "振込先の入力内容を確認してください。口座番号は数字のみです。", 422);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE organization_settings SET bank_json=?,version=version+1,updated_at=? WHERE organization_id=?").bind(JSON.stringify(parsed.data), now(), actor.organizationId),
      auditStatement(c.env.DB, actor, c.get("requestId"), "BANK_SETTINGS_UPDATED", "ORGANIZATION", actor.organizationId),
    ]);
    return c.json({ data: { saved: true } });
  });

  app.post("/api/v1/brand-assets/:kind", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
    const kind = ASSET_KINDS[c.req.param("kind") as keyof typeof ASSET_KINDS];
    if (!kind) return errorResponse("NOT_FOUND", "画像の種類を確認してください。", 404);
    const width = Number(c.req.query("width")); const height = Number(c.req.query("height"));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 6000 || height > 6000) return errorResponse("VALIDATION_ERROR", "画像サイズを確認してください。", 422);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) return errorResponse("ASSET_TOO_LARGE", "画像は1MB以下のPNGまたはJPEGを選択してください。", 413);
    const type = imageType(bytes);
    if (!type) return errorResponse("VALIDATION_ERROR", "PNGまたはJPEG形式の画像を選択してください。", 422);
    const hash = await sha256Hex(bytes); const assetId = id(); const timestamp = now();
    // Content-addressed and never overwritten, so issued snapshots keep pointing at the exact image they used.
    const objectKey = `organization/${actor.organizationId}/brand/${kind.toLowerCase()}-${hash}.${type.extension}`;
    await c.env.BRAND_ASSETS.put(objectKey, bytes, { httpMetadata: { contentType: type.mime } });
    const existing = await c.env.DB.prepare("SELECT id FROM brand_assets WHERE organization_id=? AND object_key=?").bind(actor.organizationId, objectKey).first<{ id: string }>();
    const effectiveId = existing?.id ?? assetId;
    const column = kind === "LOGO" ? "logo_asset_id" : "seal_asset_id";
    await c.env.DB.batch([
      ...(existing ? [] : [c.env.DB.prepare("INSERT INTO brand_assets(id,organization_id,kind,object_key,sha256,mime,bytes,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(assetId, actor.organizationId, kind, objectKey, hash, type.mime, bytes.length, width, height, timestamp)]),
      c.env.DB.prepare(`UPDATE organization_settings SET ${column}=?,version=version+1,updated_at=? WHERE organization_id=?`).bind(effectiveId, timestamp, actor.organizationId),
      auditStatement(c.env.DB, actor, c.get("requestId"), "BRAND_ASSET_UPDATED", "ORGANIZATION", actor.organizationId, { kind, assetId: effectiveId }),
    ]);
    return c.json({ data: { id: effectiveId, kind } }, 201);
  });

  app.delete("/api/v1/brand-assets/:kind", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
    const kind = ASSET_KINDS[c.req.param("kind") as keyof typeof ASSET_KINDS];
    if (!kind) return errorResponse("NOT_FOUND", "画像の種類を確認してください。", 404);
    // Only the setting is cleared: the stored image stays for documents already issued with it.
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE organization_settings SET ${kind === "LOGO" ? "logo_asset_id" : "seal_asset_id"}=NULL,version=version+1,updated_at=? WHERE organization_id=?`).bind(now(), actor.organizationId),
      auditStatement(c.env.DB, actor, c.get("requestId"), "BRAND_ASSET_REMOVED", "ORGANIZATION", actor.organizationId, { kind }),
    ]);
    return c.json({ data: { removed: true } });
  });

  app.get("/api/v1/brand-assets/:id", async (c) => {
    const asset = await c.env.DB.prepare("SELECT object_key,mime FROM brand_assets WHERE organization_id=? AND id=?").bind(c.get("actor").organizationId, c.req.param("id")).first<{ object_key: string; mime: string }>();
    const object = asset ? await c.env.BRAND_ASSETS.get(asset.object_key) : null;
    if (!asset || !object) return errorResponse("NOT_FOUND", "画像が見つかりません。", 404);
    return new Response(object.body, { headers: { "Content-Type": asset.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  });

  app.get("/api/v1/users", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ表示できます。", 403);
    const rows = await c.env.DB.prepare("SELECT id,email,display_name,role,active,access_subject IS NOT NULL AS signed_in,created_at FROM users WHERE organization_id=? ORDER BY active DESC,role,email").bind(actor.organizationId).all();
    return c.json({ data: rows.results });
  });

  app.post("/api/v1/users", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ追加できます。", 403);
    const parsed = UserInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "メールアドレス・氏名・権限を確認してください。", 422);
    const duplicate = await c.env.DB.prepare("SELECT 1 FROM users WHERE organization_id=? AND lower(email)=?").bind(actor.organizationId, parsed.data.email).first();
    if (duplicate) return errorResponse("USER_EXISTS", "このメールアドレスは登録済みです。", 409);
    const userId = id(); const timestamp = now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)").bind(userId, actor.organizationId, parsed.data.email, parsed.data.displayName, parsed.data.role, timestamp, timestamp),
      auditStatement(c.env.DB, actor, c.get("requestId"), "USER_CREATED", "USER", userId, { role: parsed.data.role }),
    ]);
    return c.json({ data: { id: userId } }, 201);
  });

  app.patch("/api/v1/users/:id", async (c) => {
    const actor = c.get("actor");
    if (!requireAdmin(actor)) return errorResponse("FORBIDDEN", "管理者のみ変更できます。", 403);
    const parsed = UserPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "入力内容を確認してください。", 422);
    const userId = c.req.param("id");
    const user = await c.env.DB.prepare("SELECT id,display_name,role,active FROM users WHERE organization_id=? AND id=?").bind(actor.organizationId, userId).first<{ id: string; display_name: string; role: string; active: number }>();
    if (!user) return errorResponse("NOT_FOUND", "ユーザーが見つかりません。", 404);
    const role = parsed.data.role ?? user.role; const active = parsed.data.active ?? Boolean(user.active);
    const losesAdmin = user.role === "ADMIN" && Boolean(user.active) && (role !== "ADMIN" || !active);
    if (losesAdmin && userId === actor.id) return errorResponse("SELF_LOCKOUT", "自分自身の管理者権限は変更できません。", 409);
    if (losesAdmin) {
      const admins = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE organization_id=? AND role='ADMIN' AND active=1").bind(actor.organizationId).first<{ count: number }>();
      if (Number(admins?.count ?? 0) <= 1) return errorResponse("LAST_ADMIN", "管理者は1名以上必要です。", 409);
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET display_name=?,role=?,active=?,updated_at=? WHERE organization_id=? AND id=?").bind(parsed.data.displayName ?? user.display_name, role, Number(active), now(), actor.organizationId, userId),
      auditStatement(c.env.DB, actor, c.get("requestId"), "USER_UPDATED", "USER", userId, { role, active }),
    ]);
    return c.json({ data: { saved: true } });
  });

  app.patch("/api/v1/counterparties/:id", async (c) => {
    const actor = c.get("actor"); const parsed = CounterpartyPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "取引先情報を確認してください。", 422);
    const d = parsed.data;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE counterparties SET name=?,kana=?,normalized_name=?,is_customer=?,is_supplier=?,postal_code=?,prefecture=?,address=?,building=?,phone=?,email=?,notes=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND active=1`)
        .bind(d.name, d.kana, d.name.normalize("NFKC").toLowerCase(), Number(d.isCustomer), Number(d.isSupplier), d.postalCode, d.prefecture, d.address, d.building, d.phone, d.email, d.notes, now(), actor.organizationId, c.req.param("id")),
      auditStatement(c.env.DB, actor, c.get("requestId"), "COUNTERPARTY_UPDATED", "COUNTERPARTY", c.req.param("id")),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return errorResponse("NOT_FOUND", "取引先が見つかりません。", 404);
    return c.json({ data: { saved: true } });
  });

  app.patch("/api/v1/products/:id", async (c) => {
    const actor = c.get("actor"); const parsed = ProductPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "商品・サービス情報を確認してください。", 422);
    const d = parsed.data; const productId = c.req.param("id");
    const duplicate = await c.env.DB.prepare("SELECT 1 FROM products WHERE organization_id=? AND code=? AND id<>?").bind(actor.organizationId, d.code, productId).first();
    if (duplicate) return errorResponse("PRODUCT_CODE_EXISTS", "同じ商品コードが登録されています。", 409);
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE products SET code=?,name=?,description=?,unit=?,unit_price_decimal=?,tax_class=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND active=1`)
        .bind(d.code, d.name, d.description, d.unit, d.unitPrice, d.taxClass, now(), actor.organizationId, productId),
      auditStatement(c.env.DB, actor, c.get("requestId"), "PRODUCT_UPDATED", "PRODUCT", productId),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return errorResponse("NOT_FOUND", "商品が見つかりません。", 404);
    return c.json({ data: { saved: true } });
  });

  // Master records are archived rather than deleted: issued documents keep their own snapshot.
  for (const [path, table, entity] of [["counterparties", "counterparties", "COUNTERPARTY"], ["products", "products", "PRODUCT"]] as const) {
    app.post(`/api/v1/${path}/:id/archive`, async (c) => {
      const actor = c.get("actor");
      const results = await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE ${table} SET active=0,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND active=1`).bind(now(), actor.organizationId, c.req.param("id")),
        auditStatement(c.env.DB, actor, c.get("requestId"), `${entity}_ARCHIVED`, entity, c.req.param("id")),
      ]);
      if ((results[0].meta.changes ?? 0) !== 1) return errorResponse("NOT_FOUND", "対象が見つかりません。", 404);
      return c.json({ data: { archived: true } });
    });
  }
}
