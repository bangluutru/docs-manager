import { exports, env } from "cloudflare:workers";
import { afterAll, describe, expect, it } from "vitest";
import { renderDocumentHtml, type DocumentViewModel } from "../src/jds/render";

const org = "local-organization";
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
async function call(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch(new Request(`http://localhost/api/v1${path}`, { method, headers: { "Content-Type": "application/json", "If-Match": "1", "Idempotency-Key": crypto.randomUUID(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
}
const data = async <T>(response: Response) => (await response.json() as { data: T }).data;
const invoice = { type: "INV", recipientName: "設定検証株式会社", subject: "設定の検証", issueDate: "2026-10-01", transactionDate: "2026-10-01", dueDate: "2026-10-31", taxMode: "exclusive", lines: [{ id: "line-1", description: "検証作業", quantity: "1", unit: "式", unitPrice: "1000", taxClass: "STANDARD_10" }] };
const documentSettings = { default_tax_mode: "exclusive", tax_rounding: "floor", line_rounding: "floor", theme: "standard", accent_color: "#315b78", quotation_title: "御見積書", purchase_order_title: "発注書", delivery_show_amounts: false,
  numbering: { QT: "QT-{YYYY}-{####}", DN: "DN-{YYYY}-{####}", INV: "INV-{YYYY}-{####}", RC: "RC-{YYYY}-{####}", PO: "PO-{YYYY}-{####}", OC: "OC-{YYYY}-{####}" },
  defaults: { paymentTerms: "", quoteValidDays: 30, dueRule: "NEXT_MONTH_END", quoteNotes: "", invoiceNotes: "" } };

afterAll(async () => {
  await call("/settings/documents", "PUT", documentSettings);
  await env.DB.prepare("UPDATE organization_settings SET bank_json='{}',seal_asset_id=NULL,logo_asset_id=NULL WHERE organization_id=?").bind(org).run();
});

describe("company settings", () => {
  it("saves bank, document defaults and numbering, and rejects unusable patterns", async () => {
    expect((await call("/settings/bank", "PUT", { bankName: "みずほ銀行", branchName: "丸の内支店", accountType: "ORDINARY", accountNumber: "12-34", accountHolder: "カ）ケンシヨウ" })).status).toBe(422);
    expect((await call("/settings/bank", "PUT", { bankName: "みずほ銀行", branchName: "丸の内支店", accountType: "ORDINARY", accountNumber: "1234567", accountHolder: "カ）ケンシヨウ" })).status).toBe(200);
    expect((await call("/settings/documents", "PUT", { ...documentSettings, numbering: { ...documentSettings.numbering, INV: "請求-{####}" } })).status).toBe(422);
    expect((await call("/settings/documents", "PUT", { ...documentSettings, theme: "modern", quotation_title: "見積書", numbering: { ...documentSettings.numbering, INV: "S{YYYY}-{#####}" }, defaults: { ...documentSettings.defaults, paymentTerms: "月末締め翌月末払い" } })).status).toBe(200);
    const organization = await data<{ bank: { bankName: string }; numbering: Record<string, string>; defaults: { paymentTerms: string }; theme: string; quotation_title: string }>(await call("/organization"));
    expect(organization).toMatchObject({ bank: { bankName: "みずほ銀行" }, numbering: { INV: "S{YYYY}-{#####}", QT: "QT-{YYYY}-{####}" }, defaults: { paymentTerms: "月末締め翌月末払い" }, theme: "modern", quotation_title: "見積書" });
  });

  it("freezes bank, titles and seal into new drafts, refreshes older drafts on request and issues with the configured number", async () => {
    await env.DB.prepare("UPDATE organization_settings SET bank_json='{}' WHERE organization_id=?").bind(org).run();
    const before = await data<{ id: string }>(await call("/documents", "POST", invoice));
    await call("/settings/bank", "PUT", { bankName: "三井住友銀行", branchName: "本店営業部", accountType: "CHECKING", accountNumber: "7654321", accountHolder: "カ）ケンシヨウ" });
    const upload = await exports.default.fetch(new Request("http://localhost/api/v1/brand-assets/seal?width=1&height=1", { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG }));
    expect(upload.status).toBe(201);
    const seal = await data<{ id: string }>(upload);
    expect((await exports.default.fetch(new Request("http://localhost/api/v1/brand-assets/seal?width=1&height=1", { method: "POST", headers: { "Content-Type": "image/png" }, body: new TextEncoder().encode("not an image") }))).status).toBe(422);
    const image = await call(`/brand-assets/${seal.id}`);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);

    const stale = await data<DocumentViewModel>(await call(`/documents/${before.id}`));
    expect(stale.bank?.bankName ?? "").toBe("");
    expect(stale.assets?.sealUrl).toBeUndefined();
    expect((await call(`/documents/${before.id}/refresh-issuer`, "POST", {})).status).toBe(200);
    const refreshed = await data<DocumentViewModel>(await call(`/documents/${before.id}`));
    expect(refreshed.bank).toMatchObject({ bankName: "三井住友銀行", accountType: "CHECKING" });
    expect(refreshed.assets?.sealUrl).toBe(`/api/v1/brand-assets/${seal.id}`);
    expect(renderDocumentHtml(refreshed)).toContain("当座　7654321");

    const issued = await call(`/documents/${before.id}/issue`, "POST", {}, { "If-Match": "2" });
    expect(issued.status).toBe(200);
    expect((await data<{ number: string }>(issued)).number).toMatch(/^S2026-\d{5}$/);
    const pdf = await call(`/documents/${before.id}/revisions/0/pdf`);
    expect(pdf.status).toBe(200);
    expect(new TextDecoder("latin1").decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const file = await env.DB.prepare("SELECT f.renderer_version FROM document_files f JOIN document_revisions r ON r.id=f.revision_id WHERE r.document_id=?").bind(before.id).first<{ renderer_version: string }>();
    expect(file?.renderer_version).toBe("jds-2");

    expect((await call("/brand-assets/seal", "DELETE")).status).toBe(200);
    const fresh = await data<{ id: string }>(await call("/documents", "POST", { ...invoice, type: "QT", validUntil: "2026-10-31" }));
    const quote = await data<DocumentViewModel>(await call(`/documents/${fresh.id}`));
    expect(quote.assets?.sealUrl).toBeUndefined();
    expect(quote.titles?.QT).toBe("見積書");
    expect((await call(`/brand-assets/${seal.id}`)).status).toBe(200);
  }, 30000);

  it("manages users, rejects duplicates and always keeps one active administrator", async () => {
    const timestamp = new Date().toISOString();
    await env.DB.prepare("INSERT INTO users(id,organization_id,access_subject,email,display_name,role,active,created_at,updated_at) VALUES('member-1',?,'subject-member','member@example.com','一般 社員','MEMBER',1,?,?)").bind(org, timestamp, timestamp).run();
    expect((await call("/users", "POST", { email: "Member@Example.com", displayName: "重複", role: "MEMBER" })).status).toBe(409);
    expect((await call("/users", "POST", { email: "invalid", displayName: "不正", role: "MEMBER" })).status).toBe(422);
    const created = await call("/users", "POST", { email: "admin2@example.com", displayName: "管理 次郎", role: "ADMIN" });
    expect(created.status).toBe(201);
    const adminId = (await data<{ id: string }>(created)).id;
    const list = await data<Array<{ email: string; role: string; signed_in: number }>>(await call("/users"));
    expect(list.map((user) => user.email)).toEqual(expect.arrayContaining(["member@example.com", "admin2@example.com"]));
    expect(list.find((user) => user.email === "member@example.com")?.signed_in).toBe(1);
    expect((await call(`/users/${adminId}`, "PATCH", { active: false })).status).toBe(409);
    expect((await call("/users/member-1", "PATCH", { role: "ADMIN" })).status).toBe(200);
    expect((await call(`/users/${adminId}`, "PATCH", { active: false })).status).toBe(200);
    expect((await call("/users/member-1", "PATCH", { role: "MEMBER" })).status).toBe(409);
  });
});

describe("master maintenance", () => {
  it("edits and archives counterparties and products without touching existing documents", async () => {
    const partner = await data<{ id: string }>(await call("/counterparties", "POST", { name: "編集前株式会社", isCustomer: true }));
    expect((await call(`/counterparties/${partner.id}`, "PATCH", { name: "編集後株式会社", isCustomer: false, isSupplier: false })).status).toBe(422);
    expect((await call(`/counterparties/${partner.id}`, "PATCH", { name: "編集後株式会社", isCustomer: true, isSupplier: true, building: "検証ビル 3階" })).status).toBe(200);
    const found = await data<Array<{ id: string; name: string; is_supplier: number; building: string }>>(await call("/counterparties?role=supplier&q=編集後"));
    expect(found).toEqual([expect.objectContaining({ id: partner.id, name: "編集後株式会社", is_supplier: 1, building: "検証ビル 3階" })]);
    const draft = await data<{ id: string }>(await call("/documents", "POST", { ...invoice, counterpartyId: partner.id }));
    expect((await call(`/counterparties/${partner.id}/archive`, "POST", {})).status).toBe(200);
    expect(await data<unknown[]>(await call("/counterparties?role=all&q=編集後"))).toEqual([]);
    expect((await call(`/counterparties/${partner.id}/archive`, "POST", {})).status).toBe(404);
    expect((await call(`/documents/${draft.id}`)).status).toBe(200);

    const first = await data<{ id: string }>(await call("/products", "POST", { code: "SET-001", name: "設定商品", unit: "個", unitPrice: "100", taxClass: "STANDARD_10" }));
    const second = await data<{ id: string }>(await call("/products", "POST", { code: "SET-002", name: "設定商品2", unit: "個", unitPrice: "200", taxClass: "REDUCED_8" }));
    expect((await call("/products", "POST", { code: "SET-001", name: "重複", unit: "個", unitPrice: "1", taxClass: "STANDARD_10" })).status).toBe(409);
    expect((await call(`/products/${second.id}`, "PATCH", { code: "SET-001", name: "設定商品2", unit: "個", unitPrice: "200", taxClass: "REDUCED_8" })).status).toBe(409);
    expect((await call(`/products/${first.id}`, "PATCH", { code: "SET-001", name: "改名した商品", unit: "式", unitPrice: "150.5", taxClass: "EXEMPT" })).status).toBe(200);
    expect(await data<unknown[]>(await call("/products?q=改名した商品"))).toEqual([expect.objectContaining({ unit: "式", unit_price_decimal: "150.5", tax_class: "EXEMPT" })]);
    expect((await call(`/products/${first.id}/archive`, "POST", {})).status).toBe(200);
    expect(await data<unknown[]>(await call("/products?q=改名した商品"))).toEqual([]);
  });
});
