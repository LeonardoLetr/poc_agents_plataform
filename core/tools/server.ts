import type Anthropic from "@anthropic-ai/sdk";

/**
 * Ferramentas de servidor da Anthropic: declaradas na requisição e executadas na infraestrutura
 * da Anthropic, dentro da mesma chamada ao modelo. O loop local não executa nada; apenas registra
 * os blocos `server_tool_use` e `*_tool_result` que chegam na resposta.
 *
 * Disponíveis somente para LLMs do provedor Anthropic.
 */

export type ServerToolInfo = {
  name: string;
  description: string;
  category: string;
};

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

/** Resultado de ferramenta executada pela Anthropic (`web_search_tool_result`, `web_fetch_tool_result`...). Os de MCP têm leitura própria. */
export type ServerToolResultBlock = Exclude<
  Extract<Anthropic.Beta.BetaContentBlock, { tool_use_id: string }>,
  Anthropic.Beta.BetaMCPToolResultBlock
>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Texto legível do resultado, para a linha do tempo e a auditoria. Erros chegam como objeto, nunca como exceção. */
export function describeServerResult(block: ServerToolResultBlock): { output: string; isError: boolean } {
  if (typeof block.content === "object" && "error_code" in block.content) {
    return { output: `Erro da ferramenta de servidor: ${block.content.error_code}`, isError: true };
  }
  switch (block.type) {
    case "web_search_tool_result": {
      if (!Array.isArray(block.content)) break;
      if (!block.content.length) return { output: "Nenhum resultado encontrado.", isError: false };
      const lines = block.content.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.page_age ? ` (${r.page_age})` : ""}`);
      return { output: lines.join("\n"), isError: false };
    }
    case "web_fetch_tool_result": {
      const { url, content: doc } = block.content;
      const text = doc.source.type === "text" ? doc.source.data : `[${doc.source.media_type}]`;
      const header = [url, doc.title].filter(Boolean).join("\n");
      return { output: `${header}\n\n${clip(text.trim(), 1500)}`, isError: false };
    }
    // Execução de código usada internamente pela filtragem dinâmica.
    case "code_execution_tool_result":
    case "bash_code_execution_tool_result": {
      if (!("stdout" in block.content)) break;
      const out = [block.content.stdout, block.content.stderr].filter(Boolean).join("\n");
      return { output: clip(out || "(sem saída)", 1500), isError: block.content.return_code !== 0 };
    }
    // Sem formatação própria: aparecem como JSON.
    case "advisor_tool_result":
    case "text_editor_code_execution_tool_result":
    case "tool_search_tool_result":
      break;
  }
  return { output: clip(JSON.stringify(block.content), 1500), isError: false };
}

export type Citation = {
  url: string;
  title: string | null;
  citedText: string;
};

/** Citações de páginas da web anexadas aos blocos de texto da resposta (busca e leitura de páginas). */
export function collectCitations(content: Anthropic.Beta.BetaContentBlockParam[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const b of content) {
    if (b.type !== "text") continue;
    for (const c of b.citations ?? []) {
      if (c.type !== "web_search_result_location") continue;
      const key = `${c.url}|${c.cited_text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: c.url, title: c.title, citedText: clip(c.cited_text, 300) });
    }
  }
  return out;
}
