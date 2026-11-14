import { audit } from "./audit.js";
import { db, persist } from "./store.js";
import type { Memory, MemoryKind } from "./types.js";
import { now, uid } from "./util.js";

/**
 * Memória de longo prazo com busca lexical (sobreposição de termos + peso por
 * importância e recência). É propositalmente simples para que você consiga
 * entender o ranking — em produção, troque por embeddings/vetores.
 */

const STOP = new Set(
  "a o as os de da do das dos e é em um uma para por com que no na nos nas se ao à the of and to in is for on what qual quais como".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  breakdown: { overlap: number; importance: number; recency: number };
}

export function searchMemories(query: string, opts: { agentId?: string | null; limit?: number; touch?: boolean } = {}): ScoredMemory[] {
  const q = new Set(tokenize(query));
  const pool = db.memories.filter((m) => opts.agentId === undefined || m.agentId === null || m.agentId === opts.agentId);
  const scored = pool
    .map((memory) => {
      const terms = new Set([...tokenize(memory.content), ...memory.tags.flatMap(tokenize)]);
      let hits = 0;
      for (const t of q) if (terms.has(t) || [...terms].some((x) => x.startsWith(t) || t.startsWith(x))) hits++;
      const overlap = q.size ? hits / q.size : 0;
      const importance = memory.importance / 5;
      const ageDays = (Date.now() - new Date(memory.lastAccessedAt ?? memory.createdAt).getTime()) / 86_400_000;
      const recency = Math.exp(-ageDays / 30);
      const score = overlap * 0.7 + importance * 0.2 + recency * 0.1;
      return { memory, score: overlap === 0 ? 0 : score, breakdown: { overlap, importance, recency } };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);

  if (opts.touch) {
    for (const s of scored) {
      s.memory.accessCount++;
      s.memory.lastAccessedAt = now();
    }
    persist();
  }
  return scored;
}

export function createMemory(input: {
  content: string;
  kind?: MemoryKind;
  tags?: string[];
  importance?: number;
  agentId?: string | null;
  source: Memory["source"];
  runId?: string;
}): Memory {
  const memory: Memory = {
    id: uid("mem"),
    agentId: input.agentId ?? null,
    kind: input.kind ?? "fact",
    content: input.content.trim(),
    tags: input.tags ?? [],
    importance: Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
    accessCount: 0,
    createdAt: now(),
    lastAccessedAt: null,
    source: input.source,
  };
  db.memories.push(memory);
  persist();
  audit({
    type: "memory.created",
    actor: input.source === "user" ? "user" : "agent",
    agentId: input.agentId ?? undefined,
    runId: input.runId,
    summary: `Memória (${memory.kind}) criada: ${memory.content.slice(0, 80)}`,
    data: memory,
  });
  return memory;
}

export function deleteMemory(id: string, actor: "user" | "agent", ctx: { agentId?: string; runId?: string } = {}): boolean {
  const idx = db.memories.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  const [removed] = db.memories.splice(idx, 1);
  persist();
  audit({ type: "memory.deleted", actor, ...ctx, summary: `Memória removida: ${removed.content.slice(0, 80)}`, data: removed });
  return true;
}
