import type Anthropic from "@anthropic-ai/sdk";
import { createMemory, deleteMemory, searchMemories } from "../memory.js";
import type { Memory, MemoryKind } from "../types.js";
import { clip } from "../util.js";
import { evaluate } from "./calculator.js";

export interface ToolContext {
  agentId: string;
  runId: string;
  scratchpad: string[];
  onMemoryCreated?: (m: Memory) => void;
}

export interface BuiltinTool {
  definition: Anthropic.Tool;
  category: "raciocínio" | "memória" | "web" | "utilidade";
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`Parâmetro "${name}" é obrigatório (texto).`);
  return v;
};

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "0.0.0.0" ||
    h === "[::1]"
  );
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h\d|li|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export const builtinTools: Record<string, BuiltinTool> = {
  calculator: {
    category: "raciocínio",
    definition: {
      name: "calculator",
      description:
        "Avalia uma expressão matemática com precisão. Suporta + - * / ^ %, parênteses e funções " +
        "sqrt, abs, round, floor, ceil, log (base 10), ln, sin, cos, tan, min, max e constantes pi, e.",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string", description: "Ex.: (1250 * 1.08) ^ 2 / sqrt(16)" } },
        required: ["expression"],
      },
    },
    run: async (input) => {
      const expr = str(input.expression, "expression");
      const value = evaluate(expr);
      return JSON.stringify({ expression: expr, result: value });
    },
  },

  current_time: {
    category: "utilidade",
    definition: {
      name: "current_time",
      description: "Retorna a data e hora atuais (ISO 8601) e o dia da semana. Use quando a tarefa depender do 'agora'.",
      input_schema: {
        type: "object",
        properties: { timezone: { type: "string", description: "Fuso IANA opcional, ex.: America/Sao_Paulo" } },
      },
    },
    run: async (input) => {
      const tz = typeof input.timezone === "string" && input.timezone ? input.timezone : "America/Sao_Paulo";
      const d = new Date();
      let local: string;
      try {
        local = d.toLocaleString("pt-BR", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
      } catch {
        throw new Error(`Fuso horário inválido: ${tz}`);
      }
      return JSON.stringify({ iso: d.toISOString(), timezone: tz, local });
    },
  },

  http_fetch: {
    category: "web",
    definition: {
      name: "http_fetch",
      description:
        "Faz uma requisição HTTP GET a uma URL pública e retorna o conteúdo em texto (HTML é convertido para texto, " +
        "limite de ~8000 caracteres). Útil para ler páginas, APIs JSON públicas, documentação.",
      input_schema: {
        type: "object",
        properties: { url: { type: "string", description: "URL completa iniciando com http:// ou https://" } },
        required: ["url"],
      },
    },
    run: async (input) => {
      const url = new URL(str(input.url, "url"));
      if (!/^https?:$/.test(url.protocol)) throw new Error("Somente URLs http/https são permitidas.");
      if (isPrivateHost(url.hostname)) throw new Error("Endereços locais/privados são bloqueados por segurança.");
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "AgentLab/0.1 (plataforma de estudo)" },
        redirect: "follow",
      });
      const type = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const text = type.includes("html") ? htmlToText(body) : body;
      return JSON.stringify({ status: res.status, contentType: type, url: res.url, content: clip(text, 8000) });
    },
  },

  memory_save: {
    category: "memória",
    definition: {
      name: "memory_save",
      description:
        "Salva uma informação na memória de longo prazo para ser lembrada em execuções futuras. " +
        "Use para fatos verificados, preferências do usuário e procedimentos que funcionaram.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string", description: "A informação, escrita de forma autocontida." },
          kind: { type: "string", enum: ["fact", "preference", "procedure", "episode"] },
          tags: { type: "array", items: { type: "string" } },
          importance: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["content"],
      },
    },
    run: async (input, ctx) => {
      const memory = createMemory({
        content: str(input.content, "content"),
        kind: (input.kind as MemoryKind) ?? "fact",
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        importance: typeof input.importance === "number" ? input.importance : 3,
        agentId: ctx.agentId,
        source: "agent",
        runId: ctx.runId,
      });
      ctx.onMemoryCreated?.(memory);
      return JSON.stringify({ saved: true, id: memory.id });
    },
  },

  memory_search: {
    category: "memória",
    definition: {
      name: "memory_search",
      description: "Busca na memória de longo prazo por informações relacionadas a uma consulta. Retorna as mais relevantes com pontuação.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } },
        required: ["query"],
      },
    },
    run: async (input, ctx) => {
      const results = searchMemories(str(input.query, "query"), {
        agentId: ctx.agentId,
        limit: typeof input.limit === "number" ? input.limit : 5,
        touch: true,
      });
      return JSON.stringify(
        results.map((r) => ({ id: r.memory.id, kind: r.memory.kind, content: r.memory.content, score: +r.score.toFixed(3) })),
      );
    },
  },

  memory_forget: {
    category: "memória",
    definition: {
      name: "memory_forget",
      description: "Remove uma memória pelo id (obtido via memory_search). Use quando uma informação estiver errada ou desatualizada.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    run: async (input, ctx) => {
      const ok = deleteMemory(str(input.id, "id"), "agent", { agentId: ctx.agentId, runId: ctx.runId });
      if (!ok) throw new Error("Memória não encontrada.");
      return JSON.stringify({ deleted: true });
    },
  },

  scratchpad_write: {
    category: "raciocínio",
    definition: {
      name: "scratchpad_write",
      description:
        "Anota algo na memória de trabalho (scratchpad) desta execução: planos, hipóteses, resultados parciais. " +
        "Some ao final da execução.",
      input_schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
    },
    run: async (input, ctx) => {
      ctx.scratchpad.push(str(input.note, "note"));
      return JSON.stringify({ ok: true, totalNotes: ctx.scratchpad.length });
    },
  },

  scratchpad_read: {
    category: "raciocínio",
    definition: {
      name: "scratchpad_read",
      description: "Lê todas as anotações do scratchpad desta execução.",
      input_schema: { type: "object", properties: {} },
    },
    run: async (_input, ctx) => JSON.stringify({ notes: ctx.scratchpad }),
  },
};
