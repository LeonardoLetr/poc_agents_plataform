import { z } from "zod";
import { exportConfig, importConfig } from "../backup.js";
import { ANTHROPIC_MODELS, OPENAI_PRESETS, PRICING } from "../llm/catalog.js";
import { llmHasCredentials } from "../llm/index.js";
import { BUILTIN_MCP_SERVERS, publicState } from "../mcp/manager.js";
import { db } from "../store.js";
import { errorMessage, eventsOfType } from "../util.js";
import { defineRoutes, HttpError } from "./http.js";

/** Saúde, estatísticas e exportação/importação da configuração. */

export const systemRoutes = defineRoutes((route) => {
  route("GET", "/api/health", () => ({
    ok: true,
    capabilities: { builtinMcp: Object.keys(BUILTIN_MCP_SERVERS) },
    llmsReady: db.llms.filter(llmHasCredentials).length,
    llmsTotal: db.llms.length,
    catalog: { anthropic: ANTHROPIC_MODELS, openai: OPENAI_PRESETS },
  }));

  route("GET", "/api/stats", () => {
    const runs = db.runs;
    const tokens = runs.reduce((acc, r) => ({ input: acc.input + r.usage.input, output: acc.output + r.usage.output }), {
      input: 0,
      output: 0,
    });
    let cost = 0;
    for (const r of runs) {
      const [started] = eventsOfType(r.events, "run.started");
      const p = started ? PRICING[started.model] : undefined;
      if (p) cost += (r.usage.input * p.input + r.usage.output * p.output) / 1e6;
    }
    const toolCalls = db.audit.filter((a) => a.type === "tool.call");
    const toolUsage: Record<string, number> = {};
    for (const t of toolCalls) {
      const name = t.summary.match(/Chamou (\S+)/)?.[1] ?? "?";
      toolUsage[name] = (toolUsage[name] ?? 0) + 1;
    }
    return {
      agents: db.agents.length,
      llms: db.llms.length,
      runs: runs.length,
      runsByStatus: runs.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {}),
      memories: db.memories.length,
      mcpServers: db.mcpServers.length,
      mcpConnected: db.mcpServers.filter((s) => publicState(s.id).status === "connected").length,
      toolCalls: toolCalls.length,
      toolUsage,
      tokens,
      estimatedCostUsd: +cost.toFixed(4),
      auditEntries: db.audit.length,
    };
  });

  route("GET", "/api/export", () => exportConfig());

  route("POST", "/api/import", async (_p, req) => {
    const body = z.object({ data: z.unknown(), mode: z.enum(["merge", "replace"]).default("merge") }).parse(req.body);
    try {
      return await importConfig(body.data, body.mode);
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      throw new HttpError(400, errorMessage(err));
    }
  });
});
