import { db, persist } from "./store.js";
import type { AuditEntry } from "./types.js";
import { bus, now, uid } from "./util.js";

/** Registra um evento na trilha de auditoria e o transmite ao vivo. */
export function audit(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
  const full: AuditEntry = { id: uid("aud"), ts: now(), ...entry };
  db.audit.push(full);
  persist();
  bus.emit("audit", full);
  return full;
}
