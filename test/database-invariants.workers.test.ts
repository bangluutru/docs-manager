import { exports, env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = env.DB;
const organizationId = "local-organization";
const recipient = JSON.stringify({ name: "株式会社テスト", postalCode: "", address: "", building: "", phone: "", department: "", contact: "", override: "" });
const taxSummary = JSON.stringify([{ taxClass: "STANDARD_10", rate: 10, baseYen: 1000, taxYen: 100 }]);

async function createDocument(type: "QT" | "INV" | "RC", state: "DRAFT" | "ISSUED", totalYen: number, issueDate: string) {
  const documentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db.prepare("INSERT INTO documents(id,organization_id,type,created_by,created_at) VALUES(?,?,?,?,?)")
    .bind(documentId, organizationId, type, "test-user", timestamp).run();
  await db.prepare(`INSERT INTO document_revisions(
    id,organization_id,document_id,revision,state,recipient_snapshot_json,recipient_search_name,issuer_snapshot_json,
    issue_date,tax_mode,tax_rounding,line_rounding,total_yen,tax_summary_json,type_fields_json,created_by,created_at,updated_at,issued_at
  ) VALUES(?,?,?,0,?,?,?,?,?,'exclusive','floor','floor',?,?,?,'test-user',?,?,?)`)
    .bind(revisionId, organizationId, documentId, state, recipient, "株式会社テスト", "{}", issueDate, totalYen, taxSummary, "{}", timestamp, timestamp, state === "ISSUED" ? timestamp : null).run();
  if (state === "ISSUED") await db.prepare("UPDATE documents SET current_issued_revision_id=? WHERE organization_id=? AND id=?")
    .bind(revisionId, organizationId, documentId).run();
  else await db.prepare("UPDATE documents SET active_draft_revision_id=? WHERE organization_id=? AND id=?")
    .bind(revisionId, organizationId, documentId).run();
  return { documentId, revisionId };
}

async function createItem(revisionId: string) {
  await db.prepare(`INSERT INTO document_items(
    id,organization_id,revision_id,position,description,quantity_decimal,unit,unit_price_decimal,tax_class,line_amount_yen
  ) VALUES(?,?,?,0,'作業一式','1','式','1000','STANDARD_10',1000)`)
    .bind(crypto.randomUUID(), organizationId, revisionId).run();
}

describe("D1 migration invariants", () => {
  it("rolls back all draft child-row writes when the compare-and-swap is stale", async () => {
    const { documentId, revisionId } = await createDocument("QT", "DRAFT", 1000, "2026-09-01");
    await createItem(revisionId);
    await db.prepare("UPDATE document_revisions SET version=2 WHERE id=?").bind(revisionId).run();

    await expect(db.batch([
      db.prepare("UPDATE document_revisions SET version=2 WHERE id=? AND state='DRAFT' AND version=1").bind(revisionId),
      db.prepare("INSERT INTO write_guard_failures(reason) SELECT 'stale draft version' WHERE changes()<>1"),
      db.prepare("UPDATE documents SET counterparty_id=NULL WHERE id=? AND EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND version=2)").bind(documentId, revisionId),
      db.prepare("DELETE FROM document_items WHERE revision_id=? AND EXISTS(SELECT 1 FROM document_revisions WHERE id=? AND version=2)").bind(revisionId, revisionId),
    ])).rejects.toThrow();

    const rows = await db.prepare("SELECT COUNT(*) AS count FROM document_items WHERE revision_id=?").bind(revisionId).first<{ count: number }>();
    const revision = await db.prepare("SELECT version FROM document_revisions WHERE id=?").bind(revisionId).first<{ version: number }>();
    expect(rows?.count).toBe(1);
    expect(revision?.version).toBe(2);
  });

  it("prevents moving a draft item into an issued revision and rewriting issued_at", async () => {
    const draft = await createDocument("QT", "DRAFT", 1000, "2026-09-01");
    const issued = await createDocument("QT", "ISSUED", 1000, "2026-09-01");
    await createItem(draft.revisionId);
    const item = await db.prepare("SELECT id FROM document_items WHERE revision_id=?").bind(draft.revisionId).first<{ id: string }>();

    await expect(db.prepare("UPDATE document_items SET revision_id=? WHERE id=?").bind(issued.revisionId, item!.id).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE document_revisions SET issued_at='2026-09-30T00:00:00.000Z' WHERE id=?").bind(issued.revisionId).run()).rejects.toThrow();
  });

  it("blocks payment correction after receipt claim and refuses a receipt changed away from its invoice", async () => {
    const invoice = await createDocument("INV", "ISSUED", 1000, "2026-09-01");
    const timestamp = new Date().toISOString();
    const paymentId = crypto.randomUUID();
    await db.prepare(`INSERT INTO payments(id,organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,created_by,created_at)
      VALUES(?,?,?,?,?,1000,'BANK_TRANSFER','test-user',?)`)
      .bind(paymentId, organizationId, invoice.documentId, invoice.revisionId, "2026-09-02", timestamp).run();
    const receipt = await createDocument("RC", "DRAFT", 999, "2026-09-02");
    await db.prepare("UPDATE document_revisions SET subject='請求書代金',type_fields_json=? WHERE id=?")
      .bind(JSON.stringify({ purpose: "商品代として", paymentMethod: "BANK_TRANSFER" }), receipt.revisionId).run();
    await db.prepare("INSERT INTO document_relations(id,organization_id,source_revision_id,target_document_id,kind,created_by,created_at) VALUES(?,?,?,?,'RECEIPT_FOR','test-user',?)")
      .bind(crypto.randomUUID(), organizationId, invoice.revisionId, receipt.documentId, timestamp).run();

    await expect(db.prepare("UPDATE payments SET voided_at=?,voided_by='admin',correction_reason='correction' WHERE id=?")
      .bind(timestamp, paymentId).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE document_revisions SET state='ISSUING' WHERE id=?")
      .bind(receipt.revisionId).run()).rejects.toThrow();
    const issueResponse = await exports.default.fetch(new Request(`http://localhost/api/v1/documents/${receipt.documentId}/issue`, {
      method: "POST", headers: { "Content-Type": "application/json", "If-Match":"1", "Idempotency-Key": "receipt-invariant-test" }, body: "{}",
    }));
    expect(issueResponse.status).toBe(409);
    expect((await issueResponse.json() as { error: { code: string } }).error.code).toBe("RECEIPT_SNAPSHOT_MISMATCH");
    const reservation = await db.prepare("SELECT 1 FROM number_reservations WHERE organization_id=? AND document_id=?")
      .bind(organizationId, receipt.documentId).first();
    expect(reservation).toBeNull();
  });

  it("filters customer and supplier master data by the requested role", async () => {
    const timestamp = new Date().toISOString();
    const customerId = crypto.randomUUID();
    const supplierId = crypto.randomUUID();
    const insert = db.prepare(`INSERT INTO counterparties(id,organization_id,name,normalized_name,is_customer,is_supplier,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    await db.batch([
      insert.bind(customerId, organizationId, "顧客テスト", "顧客テスト", 1, 0, timestamp, timestamp),
      insert.bind(supplierId, organizationId, "仕入先テスト", "仕入先テスト", 0, 1, timestamp, timestamp),
    ]);

    const suppliers = await exports.default.fetch("http://localhost/api/v1/counterparties?role=supplier");
    const customers = await exports.default.fetch("http://localhost/api/v1/counterparties?role=customer");
    const supplierRows = (await suppliers.json() as { data: Array<{ id: string }> }).data;
    const customerRows = (await customers.json() as { data: Array<{ id: string }> }).data;
    expect(supplierRows.map((row) => row.id)).toContain(supplierId);
    expect(supplierRows.map((row) => row.id)).not.toContain(customerId);
    expect(customerRows.map((row) => row.id)).toContain(customerId);
    expect(customerRows.map((row) => row.id)).not.toContain(supplierId);
  });

  it("replays a conversion with the same key and rejects reuse with a different payload", async () => {
    const source = await createDocument("QT", "DRAFT", 1100, "2026-09-30");
    await createItem(source.revisionId);
    await db.prepare("UPDATE document_revisions SET state='ISSUED',issued_at=? WHERE id=?")
      .bind(new Date().toISOString(), source.revisionId).run();
    await db.prepare("UPDATE documents SET current_issued_revision_id=?,active_draft_revision_id=NULL WHERE id=?")
      .bind(source.revisionId, source.documentId).run();
    const request = (type: "DN" | "INV") => exports.default.fetch(new Request(`http://localhost/api/v1/documents/${source.documentId}/convert`, {
      method: "POST", headers: { "Content-Type": "application/json", "If-Match":"1", "Idempotency-Key": "convert-repeat-test-key" }, body: JSON.stringify({ type }),
    }));
    const first = await request("DN");
    const replay = await request("DN");
    const changedPayload = await request("INV");
    const firstId = (await first.json() as { data: { id: string } }).data.id;
    const replayId = (await replay.json() as { data: { id: string } }).data.id;
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replayId).toBe(firstId);
    expect(changedPayload.status).toBe(409);
    expect((await changedPayload.json() as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
    const targets = await db.prepare("SELECT COUNT(*) AS count FROM documents WHERE organization_id=? AND type='DN'")
      .bind(organizationId).first<{ count: number }>();
    expect(targets?.count).toBe(1);
  });

  it("serializes concurrent payments and limits an invoice to one receipt claim", async () => {
    const invoice = await createDocument("INV", "ISSUED", 1000, "2026-09-01");
    const timestamp = new Date().toISOString();
    const payment = (amountYen: number) => db.prepare(`INSERT INTO payments(
      id,organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,created_by,created_at
    ) VALUES(?,?,?,?,?,?,'BANK_TRANSFER','test-user',?)`).bind(crypto.randomUUID(), organizationId, invoice.documentId, invoice.revisionId, "2026-09-30", amountYen, timestamp).run();
    const paymentAttempts = await Promise.allSettled([payment(700), payment(700)]);
    expect(paymentAttempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const paid = await db.prepare("SELECT COALESCE(SUM(amount_yen),0) AS amount FROM payments WHERE invoice_document_id=? AND voided_at IS NULL")
      .bind(invoice.documentId).first<{ amount: number }>();
    expect(paid?.amount).toBe(700);

    const fullyPaidInvoice = await createDocument("INV", "ISSUED", 1000, "2026-09-01");
    const fullPaymentId = crypto.randomUUID();
    await db.prepare(`INSERT INTO payments(id,organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,created_by,created_at)
      VALUES(?,?,?,?,?,1000,'CASH','test-user',?)`).bind(fullPaymentId, organizationId, fullyPaidInvoice.documentId, fullyPaidInvoice.revisionId, "2026-09-30", timestamp).run();
    const receiptA = await createDocument("RC", "DRAFT", 1000, "2026-09-30");
    const receiptB = await createDocument("RC", "DRAFT", 1000, "2026-09-30");
    const claim = (targetId: string) => db.prepare(`INSERT INTO document_relations(id,organization_id,source_revision_id,target_document_id,kind,created_by,created_at)
      VALUES(?,?,?,?,'RECEIPT_FOR','test-user',?)`).bind(crypto.randomUUID(), organizationId, fullyPaidInvoice.revisionId, targetId, timestamp).run();
    const receiptAttempts = await Promise.allSettled([claim(receiptA.documentId), claim(receiptB.documentId)]);
    expect(receiptAttempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const claims = await db.prepare("SELECT COUNT(*) AS count FROM document_relations WHERE organization_id=? AND source_revision_id=? AND kind='RECEIPT_FOR'")
      .bind(organizationId, fullyPaidInvoice.revisionId).first<{ count: number }>();
    expect(claims?.count).toBe(1);
  });
});
