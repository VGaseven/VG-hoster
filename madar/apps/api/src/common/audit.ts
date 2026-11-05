import { Queryable } from '../db/db';

export async function audit(
  q: Queryable,
  e: { orgId?: string | null; actorId?: string | null; action: string; entity: string; entityId?: string | null; data?: unknown },
) {
  await q.query(
    `INSERT INTO audit_log(org_id, actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [e.orgId ?? null, e.actorId ?? null, e.action, e.entity, e.entityId ?? null, JSON.stringify(e.data ?? {})],
  );
}
