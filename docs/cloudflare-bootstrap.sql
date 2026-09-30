-- Run after migrations, against a new staging/production DB.
-- Must match ORGANIZATION_ID. Re-running preserves existing settings.
PRAGMA foreign_keys=ON;
INSERT INTO organizations(id,legal_name,display_name,created_at,updated_at)
VALUES ('docs-manager-organization','','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
INSERT INTO organization_settings(organization_id,updated_at)
VALUES ('docs-manager-organization',CURRENT_TIMESTAMP)
ON CONFLICT(organization_id) DO NOTHING;
INSERT INTO numbering_settings(organization_id,type,pattern,updated_at) VALUES
 ('docs-manager-organization','QT','QT-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('docs-manager-organization','DN','DN-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('docs-manager-organization','INV','INV-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('docs-manager-organization','RC','RC-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('docs-manager-organization','PO','PO-{YYYY}-{####}',CURRENT_TIMESTAMP),
 ('docs-manager-organization','OC','OC-{YYYY}-{####}',CURRENT_TIMESTAMP)
ON CONFLICT(organization_id,type) DO NOTHING;
