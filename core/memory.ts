import { audit } from "./audit.js";
import { db, persist } from "./store.js";
import type { Memory, MemoryKind, RunRecord } from "./types.js";
import { now, uid } from "./util.js";

/**
 * Memória de longo prazo com busca lexical BM25 (relevância) combinada com importância e recência.
 * A busca é lexical de propósito: cada componente da pontuação aparece na tela de memória e pode ser explicado.
 *
 * Pontuação final = 70% relevância (BM25 normalizado) + 20% importância + 10% recência.
 */

const STOP = new Set(
  "a o as os de da do das dos e é em um uma para por com que no na nos nas se ao à the of and to in is for on what qual quais como".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Sufixos removidos pelo radicalizador, do mais longo ao mais curto (aplicado uma única vez por palavra). */
const SUFFIXES = [
  "amentos",
  "imentos",
  "amento",
  "imento",
  "mente",
  "acoes",
  "icoes",
  "idades",
  "idade",
  "acao",
  "icao",
  "ismos",
  "ismo",
  "istas",
  "ista",
  "aveis",
  "iveis",
  "avel",
  "ivel",
  "ando",
  "endo",
  "indo",
  "adas",
  "idas",
  "ados",
  "idos",
  "ada",
  "ida",
  "ado",
  "ido",
  "aram",
  "eram",
  "iram",
  "ava",
  "ia",
  "ar",
  "er",
  "ir",
  "es",
  "as",
  "os",
  "is",
  "a",
  "e",
  "o",
  "s",
];

/** Radical simplificado em português: reduz flexões comuns (plural, gênero, conjugações). */
export function stem(token: string): string {
  if (token.length <= 4 || /^\d+$/.test(token)) return token;
  for (const suf of SUFFIXES) {
    if (token.endsWith(suf) && token.length - suf.length >= 4) return token.slice(0, -suf.length);
  }
  return token;
}

/**
 * Similaridade entre radicais: 1 se iguais; parcial quando compartilham um prefixo de 4+ letras
 * (ex.: "prefir" × "prefer" → 0,67); 0 caso contrário.
 */
export function termSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 4 ? i / Math.max(a.length, b.length) : 0;
}

const K1 = 1.2;
const B = 0.75;

export type ScoredMemory = {
  memory: Memory;
  score: number;
  /** relevance: BM25 normalizado (0–1) · importance: 0–1 · recency: 0–1 */
  breakdown: { relevance: number; importance: number; recency: number };
};

export function searchMemories(
  query: string,
  opts: {
    agentId?: string | null | undefined;
    limit?: number | undefined;
    touch?: boolean | undefined;
    excludeKinds?: MemoryKind[] | undefined;
  } = {},
): ScoredMemory[] {
  const queryTerms = [...new Set(tokenize(query).map(stem))];
  const pool = db.memories.filter(
    (m) => (opts.agentId === undefined || m.agentId === null || m.agentId === opts.agentId) && !opts.excludeKinds?.includes(m.kind),
  );
  if (!queryTerms.length || !pool.length) return [];

  const docs = pool.map((memory) => ({ memory, terms: [...tokenize(memory.content), ...memory.tags.flatMap(tokenize)].map(stem) }));
  const avgLen = docs.reduce((n, d) => n + d.terms.length, 0) / docs.length || 1;

  // Frequência (parcial) de cada termo da consulta em cada documento, e em quantos documentos ele aparece.
  const freq = docs.map((d) => queryTerms.map((q) => d.terms.reduce((sum, t) => sum + termSimilarity(q, t), 0)));
  const docCount = queryTerms.map((_, qi) => freq.filter((f) => (f[qi] ?? 0) > 0).length);
  const idf = docCount.map((n) => Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)));

  const bm25 = docs.map((d, di) =>
    queryTerms.reduce((sum, _, qi) => {
      const f = freq[di]?.[qi] ?? 0;
      if (!f) return sum;
      return sum + (idf[qi] ?? 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.terms.length) / avgLen)));
    }, 0),
  );
  const best = Math.max(...bm25);

  const scored = docs
    .map((d, di) => {
      const relevance = best > 0 ? (bm25[di] ?? 0) / best : 0;
      const importance = d.memory.importance / 5;
      const ageDays = (Date.now() - new Date(d.memory.lastAccessedAt ?? d.memory.createdAt).getTime()) / 86_400_000;
      const recency = Math.exp(-ageDays / 30);
      const score = relevance > 0 ? relevance * 0.7 + importance * 0.2 + recency * 0.1 : 0;
      return { memory: d.memory, score, breakdown: { relevance, importance, recency } };
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

/**
 * Remove uma memória. O usuário pode remover qualquer uma; um agente só remove as próprias:
 * memórias globais e de outros agentes ficam protegidas.
 */
export function deleteMemory(
  id: string,
  actor: "user" | "agent",
  ctx: { agentId?: string | undefined; runId?: string | undefined } = {},
): boolean {
  const target = db.memories.find((m) => m.id === id);
  if (!target) return false;
  if (actor === "agent" && target.agentId !== ctx.agentId) {
    throw new Error(
      target.agentId === null
        ? "Esta memória é global (criada pelo usuário) e não pode ser removida por um agente. Informe o usuário se ela estiver errada."
        : "Esta memória pertence a outro agente e não pode ser removida por este.",
    );
  }
  db.memories.splice(db.memories.indexOf(target), 1);
  persist();
  audit({ type: "memory.deleted", actor, ...ctx, summary: `Memória removida: ${target.content.slice(0, 80)}`, data: target });
  return true;
}

/**
 * Resumo episódico curto e autocontido: tarefa, ferramentas, iterações e a primeira frase da resposta.
 * Nunca inclui trechos de outras memórias (o que faria os episódios crescerem a cada execução).
 */
export function summarizeEpisode(input: string, iterations: number, events: RunRecord["events"], finalText: string): string {
  // Remove marcação de markdown apenas da resposta do modelo.
  const clean = (t: string) =>
    t
      .replace(/[*_`>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const tools = [...new Set(events.flatMap((e) => (e.type === "tool.call" ? [e.name.replace(/^mcp__(.+?)__/, "$1/")] : [])))];
  const firstLine = clean(finalText.split("\n").find((l) => l.trim() && !/epis[óo]dio/i.test(l)) ?? "");
  const firstSentence = firstLine.split(/(?<=[.!?:])\s/)[0] ?? "";
  const task = input.replace(/\s+/g, " ").trim(); // a tarefa é preservada como o usuário escreveu
  const parts = [
    `Tarefa "${task.length > 80 ? `${task.slice(0, 79)}…` : task}"`,
    `${iterations} ${iterations === 1 ? "iteração" : "iterações"}`,
    tools.length ? `ferramentas: ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""}` : "sem ferramentas",
  ];
  const result = firstSentence ? ` Resultado: ${firstSentence.length > 70 ? `${firstSentence.slice(0, 69)}…` : firstSentence}` : "";
  return `${parts.join(" · ")}.${result}`.slice(0, 220);
}
