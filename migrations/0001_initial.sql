PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  prefecture TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  representative TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  access_subject TEXT,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','MEMBER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,email),
  UNIQUE (access_subject),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE organization_settings (
  organization_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  registration_number TEXT,
  qualified_mode INTEGER NOT NULL DEFAULT 0 CHECK (qualified_mode IN (0,1)),
  bank_json TEXT NOT NULL DEFAULT '{}',
  payment_terms_json TEXT NOT NULL DEFAULT '{}',
  default_tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (default_tax_mode IN ('exclusive','inclusive')),
  tax_rounding TEXT NOT NULL DEFAULT 'floor' CHECK (tax_rounding IN ('floor','half-up','ceil')),
  line_rounding TEXT NOT NULL DEFAULT 'floor' CHECK (line_rounding IN ('floor','half-up','ceil')),
  theme TEXT NOT NULL DEFAULT 'standard' CHECK (theme IN ('standard','modern')),
  accent_color TEXT NOT NULL DEFAULT '#315b78',
  logo_asset_id TEXT,
  seal_asset_id TEXT,
  delivery_show_amounts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_show_amounts IN (0,1)),
  quotation_title TEXT NOT NULL DEFAULT '御見積書',
  purchase_order_title TEXT NOT NULL DEFAULT '発注書',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE brand_assets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('LOGO','SEAL')),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE counterparties (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kana TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL,
  is_customer INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0,1)),
  is_supplier INTEGER NOT NULL DEFAULT 0 CHECK (is_supplier IN (0,1)),
  postal_code TEXT NOT NULL DEFAULT '',
  prefecture TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  default_terms_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  CHECK (is_customer = 1 OR is_supplier = 1),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE INDEX counterparties_name_idx ON counterparties(organization_id, normalized_name, id);
CREATE INDEX counterparties_roles_idx ON counterparties(organization_id, is_customer, is_supplier, active, name);

CREATE TABLE counterparty_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  counterparty_id TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,counterparty_id) REFERENCES counterparties(organization_id,id)
);
CREATE UNIQUE INDEX counterparty_default_contact_idx ON counterparty_contacts(organization_id,counterparty_id) WHERE is_default = 1 AND active = 1;

CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '個',
  unit_price_decimal TEXT NOT NULL DEFAULT '0',
  tax_class TEXT NOT NULL CHECK (tax_class IN ('STANDARD_10','REDUCED_8','NON_TAXABLE','OUT_OF_SCOPE','EXEMPT')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE INDEX products_name_idx ON products(organization_id,name,id);

CREATE TABLE numbering_settings (
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('QT','DN','INV','RC','PO','OC')),
  pattern TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,type),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE TABLE number_sequences (
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('QT','DN','INV','RC','PO','OC')),
  year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  pattern_snapshot TEXT NOT NULL,
  PRIMARY KEY (organization_id,type,year),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('QT','DN','INV','RC','PO','OC')),
  number TEXT,
  number_year INTEGER,
  sequence_value INTEGER,
  counterparty_id TEXT,
  current_issued_revision_id TEXT,
  active_draft_revision_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,number),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (organization_id,counterparty_id) REFERENCES counterparties(organization_id,id)
);
CREATE INDEX documents_type_created_idx ON documents(organization_id,type,created_at DESC,id DESC);
CREATE INDEX documents_number_idx ON documents(organization_id,number);

CREATE TABLE document_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  previous_revision_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('DRAFT','ISSUING','ISSUED','ABANDONED')),
  version INTEGER NOT NULL DEFAULT 1,
  counterparty_id TEXT,
  recipient_snapshot_json TEXT NOT NULL,
  recipient_search_name TEXT NOT NULL,
  issuer_snapshot_json TEXT NOT NULL,
  bank_snapshot_json TEXT NOT NULL DEFAULT '{}',
  render_settings_json TEXT NOT NULL DEFAULT '{}',
  issue_date TEXT NOT NULL,
  transaction_date TEXT,
  period_start TEXT,
  period_end TEXT,
  due_date TEXT,
  subject TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  tax_mode TEXT NOT NULL CHECK (tax_mode IN ('exclusive','inclusive')),
  tax_rounding TEXT NOT NULL CHECK (tax_rounding IN ('floor','half-up','ceil')),
  line_rounding TEXT NOT NULL CHECK (line_rounding IN ('floor','half-up','ceil')),
  subtotal_yen INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_yen >= 0),
  tax_yen INTEGER NOT NULL DEFAULT 0 CHECK (tax_yen >= 0),
  total_yen INTEGER NOT NULL DEFAULT 0 CHECK (total_yen >= 0),
  tax_summary_json TEXT NOT NULL DEFAULT '[]',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  type_fields_json TEXT NOT NULL DEFAULT '{}',
  snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
  renderer_version TEXT,
  tax_engine_version TEXT NOT NULL DEFAULT '1',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  issued_at TEXT,
  sent_at TEXT,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,document_id,revision),
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id),
  FOREIGN KEY (organization_id,counterparty_id) REFERENCES counterparties(organization_id,id),
  FOREIGN KEY (organization_id,previous_revision_id) REFERENCES document_revisions(organization_id,id)
);
CREATE UNIQUE INDEX document_one_working_revision_idx ON document_revisions(organization_id,document_id) WHERE state IN ('DRAFT','ISSUING');
CREATE INDEX revisions_issue_date_idx ON document_revisions(organization_id,state,issue_date DESC,id DESC);
CREATE INDEX revisions_transaction_date_idx ON document_revisions(organization_id,state,transaction_date,id);
CREATE INDEX revisions_counterparty_date_idx ON document_revisions(organization_id,counterparty_id,issue_date,id);
CREATE INDEX revisions_amount_idx ON document_revisions(organization_id,total_yen,id);
CREATE INDEX revisions_due_idx ON document_revisions(organization_id,due_date,document_id);

CREATE TABLE document_items (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  product_id TEXT,
  code TEXT,
  description TEXT NOT NULL,
  quantity_decimal TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_decimal TEXT NOT NULL,
  tax_class TEXT NOT NULL CHECK (tax_class IN ('STANDARD_10','REDUCED_8','NON_TAXABLE','OUT_OF_SCOPE','EXEMPT')),
  line_amount_yen INTEGER NOT NULL CHECK (line_amount_yen >= 0),
  transaction_date TEXT,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,revision_id,position),
  FOREIGN KEY (organization_id,revision_id) REFERENCES document_revisions(organization_id,id),
  FOREIGN KEY (organization_id,product_id) REFERENCES products(organization_id,id)
);
CREATE INDEX document_items_revision_idx ON document_items(organization_id,revision_id,position);

CREATE TABLE document_relations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  source_revision_id TEXT NOT NULL,
  target_document_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CONVERTED_FROM','DUPLICATED_FROM','ORDER_REFERENCE','RECEIPT_FOR')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,source_revision_id,target_document_id,kind),
  FOREIGN KEY (organization_id,source_revision_id) REFERENCES document_revisions(organization_id,id),
  FOREIGN KEY (organization_id,target_document_id) REFERENCES documents(organization_id,id),
  CHECK (length(source_revision_id) > 0 AND length(target_document_id) > 0)
);
CREATE INDEX relations_source_idx ON document_relations(organization_id,source_revision_id,created_at);
CREATE INDEX relations_target_idx ON document_relations(organization_id,target_document_id,created_at);
CREATE UNIQUE INDEX receipt_claim_idx ON document_relations(organization_id,source_revision_id) WHERE kind = 'RECEIPT_FOR';

CREATE TABLE number_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  year INTEGER NOT NULL,
  sequence_value INTEGER NOT NULL,
  formatted_number TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,document_id),
  UNIQUE (organization_id,formatted_number),
  UNIQUE (organization_id,type,year,sequence_value),
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  invoice_document_id TEXT NOT NULL,
  invoice_revision_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  amount_yen INTEGER NOT NULL CHECK (amount_yen > 0),
  method TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER','CASH','CARD','OTHER')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  correction_reason TEXT,
  replaces_payment_id TEXT,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,invoice_document_id) REFERENCES documents(organization_id,id),
  FOREIGN KEY (organization_id,invoice_revision_id) REFERENCES document_revisions(organization_id,id),
  FOREIGN KEY (organization_id,replaces_payment_id) REFERENCES payments(organization_id,id)
);
CREATE INDEX payments_invoice_idx ON payments(organization_id,invoice_document_id,voided_at,payment_date);
CREATE INDEX payments_date_idx ON payments(organization_id,payment_date,id);

CREATE TABLE document_files (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'ISSUED_PDF'),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  generated_at TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,revision_id,kind),
  FOREIGN KEY (organization_id,revision_id) REFERENCES document_revisions(organization_id,id)
);

CREATE TABLE issue_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING','RENDERING','STORED','COMPLETE','FAILED')),
  snapshot_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,revision_id),
  FOREIGN KEY (organization_id,revision_id) REFERENCES document_revisions(organization_id,id)
);
CREATE INDEX issue_jobs_recovery_idx ON issue_jobs(state,next_attempt_at,lease_expires_at);

CREATE TABLE idempotency_requests (
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT,
  response_json TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,actor_id,operation,key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision_id TEXT,
  occurred_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE INDEX audit_entity_idx ON audit_logs(organization_id,entity_type,entity_id,occurred_at,id);

CREATE TRIGGER documents_identity_immutable
BEFORE UPDATE OF organization_id,type,number,number_year,sequence_value ON documents
WHEN OLD.number IS NOT NULL
BEGIN SELECT RAISE(ABORT,'reserved document identity is immutable'); END;

CREATE TRIGGER issued_revision_content_immutable
BEFORE UPDATE ON document_revisions
WHEN OLD.state IN ('ISSUING','ISSUED','ABANDONED') AND (
  NEW.organization_id IS NOT OLD.organization_id OR NEW.document_id IS NOT OLD.document_id OR
  NEW.revision IS NOT OLD.revision OR NEW.previous_revision_id IS NOT OLD.previous_revision_id OR
  (NEW.state IS NOT OLD.state AND NOT (OLD.state='ISSUING' AND NEW.state IN ('ISSUED','ABANDONED'))) OR NEW.version IS NOT OLD.version OR NEW.counterparty_id IS NOT OLD.counterparty_id OR
  NEW.recipient_snapshot_json IS NOT OLD.recipient_snapshot_json OR NEW.recipient_search_name IS NOT OLD.recipient_search_name OR
  NEW.issuer_snapshot_json IS NOT OLD.issuer_snapshot_json OR NEW.bank_snapshot_json IS NOT OLD.bank_snapshot_json OR
  NEW.render_settings_json IS NOT OLD.render_settings_json OR NEW.issue_date IS NOT OLD.issue_date OR
  NEW.transaction_date IS NOT OLD.transaction_date OR NEW.period_start IS NOT OLD.period_start OR NEW.period_end IS NOT OLD.period_end OR
  NEW.due_date IS NOT OLD.due_date OR NEW.subject IS NOT OLD.subject OR NEW.currency IS NOT OLD.currency OR
  NEW.tax_mode IS NOT OLD.tax_mode OR NEW.tax_rounding IS NOT OLD.tax_rounding OR NEW.line_rounding IS NOT OLD.line_rounding OR
  NEW.subtotal_yen IS NOT OLD.subtotal_yen OR NEW.tax_yen IS NOT OLD.tax_yen OR NEW.total_yen IS NOT OLD.total_yen OR
  NEW.tax_summary_json IS NOT OLD.tax_summary_json OR NEW.conditions_json IS NOT OLD.conditions_json OR NEW.notes IS NOT OLD.notes OR
  NEW.type_fields_json IS NOT OLD.type_fields_json OR NEW.snapshot_schema_version IS NOT OLD.snapshot_schema_version OR
  NEW.renderer_version IS NOT OLD.renderer_version OR NEW.tax_engine_version IS NOT OLD.tax_engine_version OR
  NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
)
BEGIN SELECT RAISE(ABORT,'frozen document revision is immutable'); END;
CREATE TRIGGER issued_revision_no_delete
BEFORE DELETE ON document_revisions WHEN OLD.state <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'frozen document revision cannot be deleted'); END;
CREATE TRIGGER frozen_items_no_insert
BEFORE INSERT ON document_items
WHEN EXISTS (SELECT 1 FROM document_revisions r WHERE r.id=NEW.revision_id AND r.organization_id=NEW.organization_id AND r.state <> 'DRAFT')
BEGIN SELECT RAISE(ABORT,'items for frozen revision cannot be inserted'); END;
CREATE TRIGGER frozen_items_no_update
BEFORE UPDATE ON document_items
WHEN EXISTS (SELECT 1 FROM document_revisions r WHERE r.id=OLD.revision_id AND r.organization_id=OLD.organization_id AND r.state <> 'DRAFT')
BEGIN SELECT RAISE(ABORT,'items for frozen revision cannot be updated'); END;
CREATE TRIGGER frozen_items_no_delete
BEFORE DELETE ON document_items
WHEN EXISTS (SELECT 1 FROM document_revisions r WHERE r.id=OLD.revision_id AND r.organization_id=OLD.organization_id AND r.state <> 'DRAFT')
BEGIN SELECT RAISE(ABORT,'items for frozen revision cannot be deleted'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;
CREATE TRIGGER number_reservations_no_update BEFORE UPDATE ON number_reservations
BEGIN SELECT RAISE(ABORT,'number reservations are append-only'); END;
CREATE TRIGGER number_reservations_no_delete BEFORE DELETE ON number_reservations
BEGIN SELECT RAISE(ABORT,'number reservations are append-only'); END;
CREATE TRIGGER document_files_no_update BEFORE UPDATE ON document_files
BEGIN SELECT RAISE(ABORT,'issued artifact metadata is immutable'); END;
CREATE TRIGGER document_files_no_delete BEFORE DELETE ON document_files
BEGIN SELECT RAISE(ABORT,'issued artifact metadata cannot be deleted'); END;

INSERT INTO organizations(id,legal_name,display_name,created_at,updated_at)
VALUES ('local-organization','サンプル株式会社','サンプル株式会社',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO organization_settings(organization_id,updated_at) VALUES ('local-organization',CURRENT_TIMESTAMP);
INSERT INTO numbering_settings(organization_id,type,pattern,updated_at) VALUES
 ('local-organization','QT','QT-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('local-organization','DN','DN-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('local-organization','INV','INV-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('local-organization','RC','RC-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('local-organization','PO','PO-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('local-organization','OC','OC-{YYYY}-{####}',CURRENT_TIMESTAMP);
