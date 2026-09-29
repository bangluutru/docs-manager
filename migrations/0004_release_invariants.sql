-- Forward-only release hardening. Keep historical migrations unchanged.

-- A failed draft compare-and-swap must turn the surrounding D1 batch into a
-- constraint failure. D1 rolls the complete batch back when any statement
-- fails, so child-row replacement cannot run against another writer's version.
CREATE TABLE write_guard_failures (
  reason TEXT NOT NULL CHECK (reason <> 'stale draft version')
);

DROP TRIGGER frozen_items_no_update;
CREATE TRIGGER frozen_items_no_update
BEFORE UPDATE ON document_items
WHEN EXISTS (
  SELECT 1 FROM document_revisions r
  WHERE r.id=OLD.revision_id AND r.organization_id=OLD.organization_id AND r.state <> 'DRAFT'
) OR EXISTS (
  SELECT 1 FROM document_revisions r
  WHERE r.id=NEW.revision_id AND r.organization_id=NEW.organization_id AND r.state <> 'DRAFT'
)
BEGIN
  SELECT RAISE(ABORT,'items for frozen revision cannot be updated');
END;

CREATE TRIGGER issued_revision_issued_at_immutable
BEFORE UPDATE OF issued_at ON document_revisions
WHEN OLD.state='ISSUED' AND NEW.issued_at IS NOT OLD.issued_at
BEGIN
  SELECT RAISE(ABORT,'issued timestamp is immutable');
END;

-- Once a receipt claims a payment set, corrections must not race past the
-- application's read-before-write check.
CREATE TRIGGER payment_correction_blocked_after_receipt_claim
BEFORE UPDATE OF voided_at ON payments
WHEN NEW.voided_at IS NOT OLD.voided_at AND EXISTS (
  SELECT 1 FROM document_relations rel
  WHERE rel.organization_id=NEW.organization_id
    AND rel.source_revision_id=NEW.invoice_revision_id
    AND rel.kind='RECEIPT_FOR'
)
BEGIN
  SELECT RAISE(ABORT,'payment cannot be corrected after a receipt claim');
END;

-- Relation rows are business history and must not be edited away to bypass
-- payment/revision protections.
CREATE TRIGGER document_relations_no_update
BEFORE UPDATE ON document_relations
BEGIN
  SELECT RAISE(ABORT,'document relations are immutable');
END;
CREATE TRIGGER document_relations_no_delete
BEFORE DELETE ON document_relations
BEGIN
  SELECT RAISE(ABORT,'document relations cannot be deleted');
END;

-- A linked receipt must still represent the invoice it claims at the moment
-- issuance begins. This checks the effective invoice, full payment, total,
-- tax breakdown, recipient, payment date and payment method snapshot.
CREATE TRIGGER receipt_snapshot_matches_invoice_before_issue
BEFORE UPDATE OF state ON document_revisions
WHEN NEW.state='ISSUING' AND EXISTS (
  SELECT 1 FROM documents receipt
  JOIN document_relations rel ON rel.organization_id=receipt.organization_id
    AND rel.target_document_id=receipt.id AND rel.kind='RECEIPT_FOR'
  WHERE receipt.organization_id=NEW.organization_id AND receipt.id=NEW.document_id AND receipt.type='RC'
)
AND NOT EXISTS (
  SELECT 1 FROM documents receipt
  JOIN document_relations rel ON rel.organization_id=receipt.organization_id
    AND rel.target_document_id=receipt.id AND rel.kind='RECEIPT_FOR'
  JOIN document_revisions invoice ON invoice.organization_id=rel.organization_id
    AND invoice.id=rel.source_revision_id AND invoice.state='ISSUED'
  JOIN documents invoice_document ON invoice_document.organization_id=invoice.organization_id
    AND invoice_document.id=invoice.document_id AND invoice_document.type='INV'
    AND invoice_document.current_issued_revision_id=invoice.id
  WHERE receipt.organization_id=NEW.organization_id AND receipt.id=NEW.document_id
    AND invoice.total_yen > 0
    AND COALESCE((
      SELECT SUM(p.amount_yen) FROM payments p
      WHERE p.organization_id=invoice.organization_id
        AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL
    ),0)=invoice.total_yen
    AND NEW.total_yen=invoice.total_yen
    AND NEW.tax_summary_json=invoice.tax_summary_json
    AND NEW.recipient_snapshot_json=invoice.recipient_snapshot_json
    AND NEW.issue_date=(
      SELECT MAX(p.payment_date) FROM payments p
      WHERE p.organization_id=invoice.organization_id
        AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL
    )
    AND json_valid(NEW.type_fields_json)
    AND json_extract(NEW.type_fields_json,'$.paymentMethod') = CASE
      WHEN (SELECT COUNT(DISTINCT p.method) FROM payments p
        WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL)=1
      THEN (SELECT MIN(p.method) FROM payments p
        WHERE p.organization_id=invoice.organization_id AND p.invoice_document_id=invoice_document.id AND p.voided_at IS NULL)
      ELSE 'OTHER'
    END
)
BEGIN
  SELECT RAISE(ABORT,'receipt no longer matches the fully paid invoice');
END;
