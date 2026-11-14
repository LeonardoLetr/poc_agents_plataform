/**
 * Servidor MCP de exemplo — "laboratorio".
 *
 * Mostra, em ~100 linhas, como construir um servidor MCP: cada `registerTool`
 * vira uma ferramenta que qualquer cliente MCP (o Agent Lab, o Claude Desktop,
 * o Claude Code…) descobre via `tools/list` e executa via `tools/call`.
 *
 * Rodar sozinho:  node --import tsx mcp-servers/laboratorio/index.ts
 * (ele conversa por stdin/stdout usando JSON-RPC — por isso não imprime nada no stdout)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "laboratorio", version: "1.0.0" },
  { instructions: "Ferramentas didáticas: bloco de notas, dados, estatísticas de texto e conversão de unidades." },
);

const notes: { id: number; text: string; createdAt: string }[] = [];
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

server.registerTool(
  "notas_adicionar",
  {
    title: "Adicionar nota",
    description: "Adiciona uma nota ao bloco de notas do servidor (vive enquanto o servidor estiver rodando).",
    inputSchema: { texto: z.string().describe("Conteúdo da nota") },
  },
  async ({ texto }) => {
    const note = { id: notes.length + 1, text: texto, createdAt: new Date().toISOString() };
    notes.push(note);
    return text({ ok: true, nota: note, total: notes.length });
  },
);

server.registerTool(
  "notas_listar",
  { title: "Listar notas", description: "Lista todas as notas salvas no servidor.", inputSchema: {} },
  async () => text(notes.length ? notes : "Nenhuma nota ainda."),
);

server.registerTool(
  "dados_rolar",
  {
    title: "Rolar dados",
    description: "Rola dados no formato RPG, ex.: 2d6, 1d20. Útil para demonstrar aleatoriedade/ferramentas não determinísticas.",
    inputSchema: { notacao: z.string().regex(/^\d{1,2}d\d{1,3}$/).describe("Ex.: 3d6") },
  },
  async ({ notacao }) => {
    const [n, faces] = notacao.split("d").map(Number);
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * faces));
    return text({ notacao, rolagens: rolls, total: rolls.reduce((a, b) => a + b, 0) });
  },
);

server.registerTool(
  "texto_estatisticas",
  {
    title: "Estatísticas de texto",
    description: "Conta palavras, caracteres, frases e as palavras mais frequentes de um texto.",
    inputSchema: { texto: z.string() },
  },
  async ({ texto }) => {
    const words = texto.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const freq = new Map<string, number>();
    for (const w of words) if (w.length > 3) freq.set(w, (freq.get(w) ?? 0) + 1);
    return text({
      caracteres: texto.length,
      palavras: words.length,
      frases: (texto.match(/[.!?]+/g) ?? []).length || 1,
      maisFrequentes: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    });
  },
);

const UNITS: Record<string, (v: number) => [number, string]> = {
  "c->f": (v) => [v * 9 / 5 + 32, "°F"],
  "f->c": (v) => [(v - 32) * 5 / 9, "°C"],
  "km->mi": (v) => [v * 0.621371, "mi"],
  "mi->km": (v) => [v / 0.621371, "km"],
  "kg->lb": (v) => [v * 2.20462, "lb"],
  "lb->kg": (v) => [v / 2.20462, "kg"],
};

server.registerTool(
  "unidades_converter",
  {
    title: "Converter unidades",
    description: `Converte valores entre unidades. Conversões suportadas: ${Object.keys(UNITS).join(", ")}.`,
    inputSchema: { valor: z.number(), conversao: z.enum(Object.keys(UNITS) as [string, ...string[]]) },
  },
  async ({ valor, conversao }) => {
    const [result, unit] = UNITS[conversao](valor);
    return text({ entrada: valor, conversao, resultado: Math.round(result * 1000) / 1000, unidade: unit });
  },
);

await server.connect(new StdioServerTransport());
console.error("[laboratorio] servidor MCP pronto (stdio)"); // stderr: aparece nos logs do Agent Lab
