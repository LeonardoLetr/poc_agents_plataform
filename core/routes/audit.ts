import { db } from "../store.js";
import { type AuditEntry } from "../types.js";
import { defineRoutes } from "./http.js";

function filterAudit(q: Record<string, string>): AuditEntry[] {
  const types = q.type ? q.type.split(",") : null;
  const text = (q.q ?? "").toLowerCase();
  return db.audit.filter(
    (a) =>
      (!types || types.some((t) => a.type === t || a.type.startsWith(`${t}.`))) &&
      (!q.agentId || a.agentId === q.agentId) &&
      (!q.runId || a.runId === q.runId) &&
      (!q.actor || a.actor === q.actor) &&
      (!text || a.summary.toLowerCase().includes(text)),
  );
}

export const auditRoutes = defineRoutes((route) => {
  route("GET", "/api/audit", (_p, req) => {
    const limit = Math.min(1000, Number(req.query.limit ?? 300));
    const list = filterAudit(req.query);
    return { total: list.length, entries: list.slice(-limit).reverse() };
  });

  route("GET", "/api/audit/export", (_p, req) => filterAudit(req.query));
});
