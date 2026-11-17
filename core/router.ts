import { z } from "zod";
import { agentRoutes } from "./routes/agents.js";
import { auditRoutes } from "./routes/audit.js";
import { compareRoutes } from "./routes/compare.js";
import { HttpError, type ApiRequest, type ApiResponse } from "./routes/http.js";
import { llmRoutes } from "./routes/llms.js";
import { mcpRoutes } from "./routes/mcp.js";
import { memoryRoutes } from "./routes/memories.js";
import { promptRoutes } from "./routes/prompts.js";
import { runRoutes } from "./routes/runs.js";
import { systemRoutes } from "./routes/system.js";
import { toolRoutes } from "./routes/tools.js";
import { db } from "./store.js";
import { bus, errorMessage } from "./util.js";

/**
 * A API da plataforma, independente de transporte: no navegador a interface chama `handle` direto.
 * Streams ao vivo passam por `subscribe`.
 */

export type { ApiRequest, ApiResponse };

const routes = [
  ...systemRoutes,
  ...llmRoutes,
  ...toolRoutes,
  ...agentRoutes,
  ...promptRoutes,
  ...memoryRoutes,
  ...mcpRoutes,
  ...runRoutes,
  ...compareRoutes,
  ...auditRoutes,
];

export async function handle(req: ApiRequest): Promise<ApiResponse> {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(req.path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
    try {
      return { status: r.created ? 201 : 200, body: await r.handler(params, req) };
    } catch (err) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: "Dados inválidos", issues: err.issues } };
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      console.error(err);
      return { status: 500, body: { error: errorMessage(err) } };
    }
  }
  return { status: 404, body: { error: `Rota não encontrada: ${req.method} ${req.path}` } };
}

/**
 * Streams ao vivo. Devolve a função de cancelamento, ou null se o caminho não for um stream.
 *  - /api/runs/:id/stream → snapshot + eventos da execução
 *  - /api/audit/stream    → novos registros de auditoria
 *  - /api/mcp/events      → mudanças de status dos servidores MCP
 */
export function subscribe(path: string, send: (data: unknown) => void): (() => void) | null {
  const run = path.match(/^\/api\/runs\/([^/]+)\/stream$/);
  if (run) {
    const record = db.runs.find((r) => r.id === run[1]);
    if (!record) return null;
    send({ type: "snapshot", run: { ...record, events: undefined, messages: undefined }, events: record.events });
    return bus.on(`run:${record.id}`, send);
  }
  if (path === "/api/audit/stream") return bus.on("audit", send);
  if (path === "/api/mcp/events") return bus.on("mcp", send);
  return null;
}
