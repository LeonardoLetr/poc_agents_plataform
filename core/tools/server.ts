import type Anthropic from "@anthropic-ai/sdk";

/**
 * Ferramentas de servidor da Anthropic: declaradas na requisição e executadas na infraestrutura
 * da Anthropic, dentro da mesma chamada ao modelo. O loop local não executa nada; apenas registra
 * os blocos `server_tool_use` e `*_tool_result` que chegam na resposta.
 *
 * Disponíveis somente para LLMs do provedor Anthropic.
 */

export interface ServerToolInfo {
  name: string;
  description: string;
  category: string;
}

export const SERVER_TOOLS: Record<string, ServerToolInfo> = {
  web_search: {
    name: "web_search",
    description: "Busca na web executada pela Anthropic, com resultados citáveis. Disponível apenas para LLMs Anthropic.",
    category: "web (servidor)",
  },
  web_fetch: {
    name: "web_fetch",
    description: "Leitura de páginas e PDFs executada pela Anthropic, sem restrição de CORS. Acessa apenas URLs presentes na conversa.",
    category: "web (servidor)",
  },
};

/** Limites por requisição: controlam custo e evitam que uma execução faça buscas sem fim. */
export const SERVER_TOOL_LIMITS = { maxUses: 5, maxContentTokens: 20_000 };

export const isServerTool = (name: string) => Object.hasOwn(SERVER_TOOLS, name);

/**
 * Modelos com as versões de 2026-02-09 (filtragem dinâmica dos resultados). Os demais usam as versões básicas.
 */
export function supportsDynamicFiltering(model: string): boolean {
  return /^claude-(fable|mythos)-/.test(model) || /^claude-opus-(5|4-[678])\b/.test(model) || /^claude-sonnet-(5|4-6)\b/.test(model);
}

export function serverToolDefinitions(names: string[], model: string): Anthropic.Beta.BetaToolUnion[] {
  const dynamic = supportsDynamicFiltering(model);
  const defs: Anthropic.Beta.BetaToolUnion[] = [];
  if (names.includes("web_search")) {
    defs.push({ type: dynamic ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: SERVER_TOOL_LIMITS.maxUses });
  }
  if (names.includes("web_fetch")) {
    defs.push({
      type: dynamic ? "web_fetch_20260209" : "web_fetch_20250910",
      name: "web_fetch",
      max_uses: SERVER_TOOL_LIMITS.maxUses,
      max_content_tokens: SERVER_TOOL_LIMITS.maxContentTokens,
      citations: { enabled: true },
    });
  }
  return defs;
}

type AnyBlock = { type: string; [k: string]: unknown };

/** Bloco de resultado de ferramenta de servidor (`web_search_tool_result`, `web_fetch_tool_result`, ...). */
export const isServerToolResult = (b: AnyBlock): b is AnyBlock & { tool_use_id: string } =>
  b.type.endsWith("_tool_result") && b.type !== "tool_result" && typeof b.tool_use_id === "string";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Texto legível do resultado, para a linha do tempo e a auditoria. Erros chegam como objeto, nunca como exceção. */
export function describeServerResult(block: AnyBlock): { output: string; isError: boolean } {
  const content = block.content as unknown;
  if (content && typeof content === "object" && !Array.isArray(content) && "error_code" in content) {
    return { output: `Erro da ferramenta de servidor: ${String((content as { error_code: unknown }).error_code)}`, isError: true };
  }
  // web_search: lista de resultados.
  if (Array.isArray(content)) {
    const results = content as { type?: string; title?: string; url?: string; page_age?: string | null }[];
    if (!results.length) return { output: "Nenhum resultado encontrado.", isError: false };
    const lines = results.map((r, i) => `${i + 1}. ${r.title ?? "(sem título)"} — ${r.url ?? ""}${r.page_age ? ` (${r.page_age})` : ""}`);
    return { output: lines.join("\n"), isError: false };
  }
  if (content && typeof content === "object") {
    const c = content as {
      type?: string;
      url?: string;
      retrieved_at?: string;
      content?: { title?: string | null; source?: { type?: string; data?: string; media_type?: string } };
      stdout?: string;
      stderr?: string;
      return_code?: number;
    };
    // web_fetch: documento recuperado.
    if (c.type === "web_fetch_result") {
      const doc = c.content;
      const text = doc?.source?.type === "text" ? (doc.source.data ?? "") : `[${doc?.source?.media_type ?? "documento"}]`;
      const header = [c.url, doc?.title].filter(Boolean).join("\n");
      return { output: `${header}\n\n${clip(text.trim(), 1500)}`, isError: false };
    }
    // Execução de código usada internamente pela filtragem dinâmica.
    if (typeof c.stdout === "string" || typeof c.return_code === "number") {
      const out = [c.stdout, c.stderr].filter(Boolean).join("\n");
      return { output: clip(out || "(sem saída)", 1500), isError: (c.return_code ?? 0) !== 0 };
    }
  }
  return { output: clip(JSON.stringify(content ?? null), 1500), isError: false };
}

export interface Citation {
  url: string;
  title: string | null;
  citedText: string;
}

/** Citações anexadas aos blocos de texto da resposta (busca e leitura de páginas). */
export function collectCitations(content: AnyBlock[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const b of content) {
    if (b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const c of b.citations as { type?: string; url?: string; title?: string | null; cited_text?: string; document_title?: string | null }[]) {
      const url = c.url;
      if (!url) continue;
      const key = `${url}|${c.cited_text ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, title: c.title ?? c.document_title ?? null, citedText: clip(c.cited_text ?? "", 300) });
    }
  }
  return out;
}
