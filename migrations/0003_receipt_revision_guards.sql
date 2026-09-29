DROP TRIGGER relation_receipt_for_effective_invoice;
CREATE TRIGGER relation_receipt_for_effective_invoice
BEFORE INSERT ON document_relations
WHEN NEW.kind='RECEIPT_FOR' AND NOT EXISTS (
  SELECT 1 FROM documents d
  JOIN document_revisions r ON r.organization_id=d.organization_id AND r.id=d.current_issued_revision_id
  JOIN documents receipt ON receipt.organization_id=NEW.organization_id AND receipt.id=NEW.target_document_id AND receipt.type='RC'
  WHERE d.organization_id=NEW.organization_id AND r.id=NEW.source_revision_id AND d.type='INV' AND r.state='ISSUED'
    AND r.total_yen > 0
    AND COALESCE((SELECT SUM(p.amount_yen) FROM payments p WHERE p.organization_id=d.organization_id AND p.invoice_document_id=d.id AND p.voided_at IS NULL),0)=r.total_yen
)
BEGIN
  SELECT RAISE(ABORT,'receipt requires a fully paid effective invoice');
END;

DROP TRIGGER documents_draft_revision_guard;
CREATE TRIGGER documents_draft_revision_guard
BEFORE UPDATE OF active_draft_revision_id ON documents
WHEN NEW.active_draft_revision_id IS NOT OLD.active_draft_revision_id AND NEW.active_draft_revision_id IS NOT NULL AND (
  NOT EXISTS (
    SELECT 1 FROM document_revisions r WHERE r.organization_id=NEW.organization_id AND r.document_id=NEW.id
      AND r.id=NEW.active_draft_revision_id AND r.state='DRAFT'
  ) OR
  (NEW.type='INV' AND OLD.current_issued_revision_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM payments p WHERE p.organization_id=NEW.organization_id AND p.invoice_document_id=NEW.id AND p.voided_at IS NULL) OR
    EXISTS (SELECT 1 FROM document_relations rel WHERE rel.organization_id=NEW.organization_id AND rel.source_revision_id=OLD.current_issued_revision_id AND rel.kind='RECEIPT_FOR')
  ))
)
BEGIN
  SELECT RAISE(ABORT,'active draft must be editable and an invoice with payments or a receipt cannot be revised');
END;
