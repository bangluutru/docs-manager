-- Fail the entire issuance transaction when the validated draft has changed.
CREATE TRIGGER issue_write_guard
BEFORE INSERT ON write_guard_failures
WHEN NEW.reason='stale issue version'
BEGIN
  SELECT RAISE(ABORT,'stale issue version');
END;

-- A correction and payments must not compete for the effective invoice.
CREATE TRIGGER payments_blocked_during_revision
BEFORE INSERT ON payments
WHEN EXISTS (
  SELECT 1 FROM documents d
  WHERE d.organization_id=NEW.organization_id AND d.id=NEW.invoice_document_id
    AND d.current_issued_revision_id IS NOT NULL AND d.active_draft_revision_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'payment blocked during invoice revision');
END;

-- Nullable for pre-migration jobs, whose frozen revision remains the source.
ALTER TABLE issue_jobs ADD COLUMN snapshot_json TEXT;
CREATE TRIGGER issue_job_snapshot_immutable
BEFORE UPDATE OF snapshot_hash,snapshot_json,object_key,revision_id,organization_id ON issue_jobs
BEGIN
  SELECT RAISE(ABORT,'issue job snapshot is immutable');
END;
CREATE INDEX products_page_idx ON products(organization_id,active,name,id);
CREATE INDEX counterparties_page_idx ON counterparties(organization_id,active,normalized_name,id);

CREATE TRIGGER issue_finalize_guard
BEFORE INSERT ON write_guard_failures
WHEN NEW.reason='issue finalize conflict'
BEGIN
  SELECT RAISE(ABORT,'issue finalize conflict');
END;

-- Normalize legacy prices accepted by the old master-only decimal validator.
UPDATE products SET unit_price_decimal=CASE
  WHEN ltrim(unit_price_decimal,'0')='' THEN '0'
  WHEN substr(ltrim(unit_price_decimal,'0'),1,1)='.' THEN '0'||ltrim(unit_price_decimal,'0')
  ELSE ltrim(unit_price_decimal,'0') END,
  version=version+1,updated_at=CURRENT_TIMESTAMP
WHERE unit_price_decimal GLOB '0[0-9]*';
