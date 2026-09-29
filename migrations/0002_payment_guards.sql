CREATE TRIGGER payments_only_on_effective_invoice
BEFORE INSERT ON payments
WHEN NOT EXISTS (
  SELECT 1 FROM documents d
  JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id
  WHERE d.organization_id=NEW.organization_id AND d.id=NEW.invoice_document_id AND d.type='INV'
    AND r.id=NEW.invoice_revision_id AND r.state='ISSUED'
    AND NEW.amount_yen <= r.total_yen - COALESCE((
      SELECT SUM(p.amount_yen) FROM payments p
      WHERE p.organization_id=NEW.organization_id AND p.invoice_document_id=NEW.invoice_document_id AND p.voided_at IS NULL
    ),0)
)
BEGIN
  SELECT RAISE(ABORT,'payment exceeds the effective invoice balance or invoice is not issued');
END;

CREATE TRIGGER payment_identity_immutable
BEFORE UPDATE OF organization_id,invoice_document_id,invoice_revision_id,payment_date,amount_yen,method,note,created_by,created_at,replaces_payment_id ON payments
BEGIN
  SELECT RAISE(ABORT,'payment entries are immutable; append a correction');
END;

CREATE TRIGGER payments_no_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT,'payment entries cannot be deleted');
END;

CREATE UNIQUE INDEX one_receipt_per_invoice_revision
ON document_relations(organization_id,source_revision_id)
WHERE kind='RECEIPT_FOR';

CREATE UNIQUE INDEX one_replacement_per_payment
ON payments(organization_id,replaces_payment_id)
WHERE replaces_payment_id IS NOT NULL;

CREATE TRIGGER payment_correction_target_guard
BEFORE INSERT ON payments
WHEN NEW.replaces_payment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM payments original
  WHERE original.organization_id=NEW.organization_id
    AND original.id=NEW.replaces_payment_id
    AND original.invoice_document_id=NEW.invoice_document_id
    AND original.invoice_revision_id=NEW.invoice_revision_id
    AND original.voided_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'replacement payment must reference a voided payment for the same invoice');
END;

CREATE TRIGGER payment_correction_metadata_immutable
BEFORE UPDATE ON payments
WHEN OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR length(trim(NEW.correction_reason))=0
BEGIN
  SELECT RAISE(ABORT,'payment corrections are immutable and require a reason');
END;

CREATE TRIGGER only_admin_correction_fields
BEFORE UPDATE ON payments
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR
  NEW.invoice_document_id IS NOT OLD.invoice_document_id OR NEW.invoice_revision_id IS NOT OLD.invoice_revision_id OR
  NEW.payment_date IS NOT OLD.payment_date OR NEW.amount_yen IS NOT OLD.amount_yen OR NEW.method IS NOT OLD.method OR
  NEW.note IS NOT OLD.note OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR
  NEW.replaces_payment_id IS NOT OLD.replaces_payment_id OR NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR length(trim(NEW.correction_reason))=0
BEGIN
  SELECT RAISE(ABORT,'payment correction must preserve the original and include a reason');
END;

CREATE TRIGGER relation_receipt_for_effective_invoice
BEFORE INSERT ON document_relations
WHEN NEW.kind='RECEIPT_FOR' AND NOT EXISTS (
  SELECT 1 FROM documents d
  JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id
  JOIN documents receipt ON receipt.organization_id=NEW.organization_id AND receipt.id=NEW.target_document_id AND receipt.type='RC'
  WHERE d.organization_id=NEW.organization_id AND r.id=NEW.source_revision_id AND d.type='INV' AND r.state='ISSUED'
)
BEGIN
  SELECT RAISE(ABORT,'receipt must reference the effective issued invoice');
END;

CREATE TRIGGER documents_effective_revision_guard
BEFORE UPDATE OF current_issued_revision_id ON documents
WHEN NEW.current_issued_revision_id IS NOT OLD.current_issued_revision_id AND (
  (NEW.current_issued_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document_revisions r WHERE r.organization_id=NEW.organization_id
      AND r.document_id=NEW.id AND r.id=NEW.current_issued_revision_id AND r.state='ISSUED'
  )) OR
  (OLD.current_issued_revision_id IS NOT NULL AND OLD.type='INV' AND (
    EXISTS (SELECT 1 FROM payments p WHERE p.organization_id=OLD.organization_id AND p.invoice_document_id=OLD.id AND p.voided_at IS NULL) OR
    EXISTS (SELECT 1 FROM document_relations rel WHERE rel.organization_id=OLD.organization_id AND rel.source_revision_id=OLD.current_issued_revision_id AND rel.kind='RECEIPT_FOR')
  ))
)
BEGIN
  SELECT RAISE(ABORT,'effective revision must be issued and cannot replace an invoice with payments or a receipt');
END;

CREATE TRIGGER documents_draft_revision_guard
BEFORE UPDATE OF active_draft_revision_id ON documents
WHEN NEW.active_draft_revision_id IS NOT OLD.active_draft_revision_id AND NEW.active_draft_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM document_revisions r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id
    AND r.id=NEW.active_draft_revision_id AND r.state='DRAFT'
)
BEGIN
  SELECT RAISE(ABORT,'active draft must belong to the document and be editable');
END;
