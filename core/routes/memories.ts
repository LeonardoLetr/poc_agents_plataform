import { z } from "zod";
import { audit } from "../audit.js";
import { createMemory, deleteMemory, searchMemories } from "../memory.js";
import { db, persist } from "../store.js";
import { MEMORY_KINDS } from "../types.js";
import { defineRoutes, notFound } from "./http.js";

const MemoryInput = z.object({
  content: z.string().min(1),
  kind: z.enum(MEMORY_KINDS).default("fact"),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(1).max(5).default(3),
  agentId: z.string().nullable().default(null),
});

export const memoryRoutes = defineRoutes((route) => {
  route("GET", "/api/memories", (_p, req) =>
    req.query.agentId ? db.memories.filter((m) => m.agentId === req.query.agentId || m.agentId === null) : db.memories,
  );

  route("GET", "/api/memories/search", (_p, req) =>
    searchMemories(req.query.q ?? "", { agentId: req.query.agentId || undefined, limit: 20 }),
  );

  route("POST", "/api/memories", (_p, req) => createMemory({ ...MemoryInput.parse(req.body), source: "user" }), { created: true });

  route("PUT", "/api/memories/:id", ({ id }, req) => {
    const memory = db.memories.find((m) => m.id === id) ?? notFound("Memória");
    const before = structuredClone(memory);
    Object.assign(memory, MemoryInput.parse(req.body));
    persist();
    audit({
      type: "memory.updated",
      actor: "user",
      summary: `Memória editada: ${memory.content.slice(0, 80)}`,
      data: { before, after: memory },
    });
    return memory;
  });

  route("DELETE", "/api/memories/:id", ({ id }) => (deleteMemory(id, "user") ? { ok: true } : notFound("Memória")));
});
