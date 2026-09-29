import { exports, env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.DB;
const organizationId = "local-organization";

async function createPurchaseDraft(type: "PO" | "OC", role: "supplier" | "customer") {
  const timestamp = new Date().toISOString();
  const counterpartyId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  await db.prepare(`INSERT INTO counterparties(id,organization_id,name,normalized_name,is_customer,is_supplier,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(counterpartyId, organizationId, role === "supplier" ? "仕入先株式会社" : "顧客株式会社", role, Number(role === "customer"), Number(role === "supplier"), timestamp, timestamp).run();
  await db.prepare(`INSERT INTO documents(id,organization_id,type,counterparty_id,active_draft_revision_id,created_by,created_at)
    VALUES(?,?,?,?,?,'test-user',?)`).bind(documentId, organizationId, type, counterpartyId, revisionId, timestamp).run();
  const recipientName = role === "supplier" ? "仕入先株式会社" : "顧客株式会社";
  const typeFields = type === "PO"
    ? { requestedDeliveryDate: "2026-10-15", paymentTerms: "月末締め翌月末払い" }
    : { acceptedDate: "2026-09-30", deliveryDate: "2026-10-15", paymentTerms: "月末締め翌月末払い", purchaseOrderNumber: "CUST-001" };
  await db.prepare(`INSERT INTO document_revisions(
    id,organization_id,document_id,revision,state,version,counterparty_id,recipient_snapshot_json,recipient_search_name,
    issuer_snapshot_json,bank_snapshot_json,render_settings_json,issue_date,subject,tax_mode,tax_rounding,line_rounding,
    subtotal_yen,tax_yen,total_yen,tax_summary_json,type_fields_json,created_by,created_at,updated_at
  ) VALUES(?,?,?,0,'DRAFT',1,?,?,?,?,?,?,?,?, 'exclusive','floor','floor',1000,100,1100,?,?, 'test-user',?,?)`)
    .bind(revisionId, organizationId, documentId, counterpartyId,
      JSON.stringify({ name: recipientName, postalCode: "", address: "東京都千代田区", building: "", phone: "", department: "", contact: "", override: "" }),
      recipientName, JSON.stringify({ legalName: "自社株式会社", address: "東京都港区" }), "{}", JSON.stringify({ theme: "standard", accentColor: "#315b78" }),
      "2026-09-30", type === "PO" ? "業務委託の発注" : "受注内容の確認", JSON.stringify([{ taxClass: "STANDARD_10", rate: 10, baseYen: 1000, taxYen: 100 }]),
      JSON.stringify(typeFields), timestamp, timestamp).run();
  await db.prepare(`INSERT INTO document_items(id,organization_id,revision_id,position,description,quantity_decimal,unit,unit_price_decimal,tax_class,line_amount_yen)
    VALUES(?,?,?,0,'業務一式','1','式','1000','STANDARD_10',1000)`)
    .bind(crypto.randomUUID(), organizationId, revisionId).run();
  return { documentId, revisionId, counterpartyId };
}

describe("outgoing purchase documents", () => {
  it("issues a PO from our company to a supplier and stores its immutable PDF", async () => {
    const draft = await createPurchaseDraft("PO", "supplier");
    const response = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-po-test-key" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    const result = (await response.json() as { data: { issued: boolean; number: string } }).data;
    expect(result).toMatchObject({ issued: true });
    expect(result.number).toMatch(/^PO-2026-/);
    const retry = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-po-test-key" }, body: "{}",
    }));
    const retryResult = (await retry.json() as { data: { number: string } }).data;
    expect(retry.status).toBe(200);
    expect(retryResult.number).toBe(result.number);
    const issued = await db.prepare(`SELECT r.state,d.current_issued_revision_id,j.state job_state,f.object_key
      FROM document_revisions r JOIN documents d ON d.id=r.document_id
      JOIN issue_jobs j ON j.revision_id=r.id JOIN document_files f ON f.revision_id=r.id WHERE r.id=?`)
      .bind(draft.revisionId).first<{ state: string; current_issued_revision_id: string; job_state: string; object_key: string }>();
    expect(issued).toMatchObject({ state: "ISSUED", current_issued_revision_id: draft.revisionId, job_state: "COMPLETE" });
    expect(await env.DOCUMENT_ARTIFACTS.head(issued!.object_key)).not.toBeNull();
  }, 30000);

  it("issues an OC to a customer, replays idempotently, stores the PDF, and keeps the issued revision immutable", async () => {
    const draft = await createPurchaseDraft("OC", "customer");
    const role = await db.prepare("SELECT is_customer,is_supplier FROM counterparties WHERE id=?").bind(draft.counterpartyId).first<{is_customer:number;is_supplier:number}>();
    expect(role).toEqual({ is_customer: 1, is_supplier: 0 });
    const response = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-oc-test-key" }, body: "{}",
    }));
    expect(response.status).toBe(200);
    const result = (await response.json() as { data: { issued: boolean; number: string } }).data;
    expect(result.issued).toBe(true);
    expect(result.number).toMatch(/^OC-2026-/);

    const retry = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-oc-test-key" }, body: "{}",
    }));
    expect(retry.status).toBe(200);
    expect((await retry.json() as { data: { number: string } }).data.number).toBe(result.number);

    const issued = await db.prepare(`SELECT r.state,d.current_issued_revision_id,j.state job_state,f.object_key
      FROM document_revisions r JOIN documents d ON d.id=r.document_id
      JOIN issue_jobs j ON j.revision_id=r.id JOIN document_files f ON f.revision_id=r.id WHERE r.id=?`)
      .bind(draft.revisionId).first<{ state: string; current_issued_revision_id: string; job_state: string; object_key: string }>();
    expect(issued).toMatchObject({ state: "ISSUED", current_issued_revision_id: draft.revisionId, job_state: "COMPLETE" });
    expect(await env.DOCUMENT_ARTIFACTS.head(issued!.object_key)).not.toBeNull();
    const reservation = await db.prepare("SELECT type,sequence_value FROM number_reservations WHERE document_id=?").bind(draft.documentId).first<{type:string;sequence_value:number}>();
    expect(reservation).toEqual({ type: "OC", sequence_value: 1 });
    const [reservationCount,jobCount,fileCount] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM number_reservations WHERE document_id=?").bind(draft.documentId).first<{count:number}>(),
      db.prepare("SELECT COUNT(*) AS count FROM issue_jobs WHERE revision_id=?").bind(draft.revisionId).first<{count:number}>(),
      db.prepare("SELECT COUNT(*) AS count FROM document_files WHERE revision_id=?").bind(draft.revisionId).first<{count:number}>(),
    ]);
    expect([reservationCount?.count,jobCount?.count,fileCount?.count]).toEqual([1,1,1]);
    const item = await db.prepare("SELECT id FROM document_items WHERE revision_id=?").bind(draft.revisionId).first<{id:string}>();
    await expect(db.prepare("UPDATE document_items SET description='変更された帳票' WHERE id=?").bind(item!.id).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE document_revisions SET issued_at='2026-09-30T00:00:00.000Z' WHERE id=?").bind(draft.revisionId).run()).rejects.toThrow();
  }, 30000);

  it("rejects a supplier-only OC before reserving an issue number", async () => {
    const draft = await createPurchaseDraft("OC", "supplier");
    const response = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-oc-wrong-role" }, body: "{}",
    }));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("COUNTERPARTY_ROLE_MISMATCH");
    const reservation = await db.prepare("SELECT 1 FROM number_reservations WHERE document_id=?").bind(draft.documentId).first();
    expect(reservation).toBeNull();
    const state = await db.prepare("SELECT state FROM document_revisions WHERE id=?").bind(draft.revisionId).first<{state:string}>();
    expect(state?.state).toBe("DRAFT");
  });

  it("requires an OC accepted date before reserving an issue number", async () => {
    const draft = await createPurchaseDraft("OC", "customer");
    await db.prepare("UPDATE document_revisions SET type_fields_json=? WHERE id=?")
      .bind(JSON.stringify({ acceptedDate: null, deliveryDate: "2026-10-15", paymentTerms: "月末締め翌月末払い", purchaseOrderNumber: "CUST-001" }), draft.revisionId).run();
    const response = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-oc-missing-date" }, body: "{}",
    }));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("ISSUE_VALIDATION");
    const reservation = await db.prepare("SELECT 1 FROM number_reservations WHERE document_id=?").bind(draft.documentId).first();
    expect(reservation).toBeNull();
  });

  it("rejects the wrong master-data role before reserving an issue number", async () => {
    const draft = await createPurchaseDraft("PO", "customer");
    const response = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${draft.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "issue-po-wrong-role" }, body: "{}",
    }));
    expect(response.status).toBe(422);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("COUNTERPARTY_ROLE_MISMATCH");
    const reservation = await db.prepare("SELECT 1 FROM number_reservations WHERE document_id=?").bind(draft.documentId).first();
    expect(reservation).toBeNull();
  });
});
