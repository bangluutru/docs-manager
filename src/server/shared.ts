export interface Env {
  DB: D1Database;
  DOCUMENT_ARTIFACTS: R2Bucket;
  BRAND_ASSETS: R2Bucket;
  BROWSER: Fetcher;
  ASSETS: Fetcher;
  APP_ENV: string;
  ORGANIZATION_ID: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SETUP_TOKEN?: string;
}
export interface Actor { id: string; email: string; name: string; role: "ADMIN" | "MEMBER"; organizationId: string; subject?: string }
export type AppEnv = { Bindings: Env; Variables: { actor: Actor; requestId: string } };

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function errorResponse(code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500) {
  return Response.json({ error: { code, message } }, { status });
}
export function requireAdmin(actor: Actor): boolean { return actor.role === "ADMIN"; }

export function auditStatement(db: D1Database, actor: Actor, requestId: string, action: string, entityType: string, entityId: string, details: unknown = {}) {
  return db.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,occurred_at,request_id,details_json) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id(), actor.organizationId, actor.id, action, entityType, entityId, now(), requestId, JSON.stringify(details));
}

export const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === "string" && value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
