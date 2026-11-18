import { z } from "zod";
import { startRun } from "../agent/runner.js";
import { audit } from "../audit.js";
import { runCost } from "../llm/catalog.js";
import { db } from "../store.js";
import { type RunRecord } from "../types.js";
import { errorMessage, eventsOfType, uid } from "../util.js";
import { defineRoutes, HttpError, notFound } from "./http.js";
import { checkLlm } from "./llms.js";

/** Métricas de uma execução, usadas na comparação. Sem preço conhecido, o custo fica `null` ("não estimado"). */
function runMetrics(r: RunRecord) {
  const [started] = eventsOfType(r.events, "run.started");
  const model = started?.model ?? "";
  const toolCalls = eventsOfType(r.events, "tool.call").map((e) => e.name);
  const cost = runCost(r, db.llms);
  return {
    runId: r.id,
    agentId: r.agentId,
    agentName: r.agentName,
    llmId: r.llmId,
    llmName: started?.llmName ?? "",
    provider: started?.provider ?? "",
    model,
    status: r.status,
    error: r.error,
    output: r.output,
    iterations: r.iterations,
    tokens: { input: r.usage.input, output: r.usage.output, total: r.usage.input + r.usage.output },
    costUsd: cost === null ? null : +cost.toFixed(6),
    durationMs: r.finishedAt ? new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime() : null,
    toolCalls: toolCalls.length,
    tools: [...new Set(toolCalls)],
  };
}

const CompareInput = z.object({
  input: z.string().min(1),
  entries: z
    .array(z.object({ agentId: z.string(), llmId: z.string().optional() }))
    .min(2, "Escolha ao menos 2 combinações")
    .max(4, "No máximo 4 combinações"),
});

export const compareRoutes = defineRoutes((route) => {
  route(
    "POST",
    "/api/compare",
    (_p, req) => {
      const body = CompareInput.parse(req.body);
      const plan = body.entries.map((e) => {
        const agent = db.agents.find((a) => a.id === e.agentId) ?? notFound("Agente");
        if (e.llmId) checkLlm(e.llmId);
        return { agent, llmId: e.llmId };
      });
      const comparisonId = uid("cmp");
      const runIds = plan.map(({ agent, llmId }) => {
        try {
          return startRun(agent, body.input, { llmId, comparisonId }).id;
        } catch (err) {
          throw new HttpError(400, errorMessage(err));
        }
      });
      audit({
        type: "config.changed",
        actor: "user",
        summary: `Comparação iniciada com ${runIds.length} combinações`,
        data: { comparisonId, input: body.input, entries: body.entries },
      });
      return { id: comparisonId, runIds };
    },
    { created: true },
  );

  route("GET", "/api/compare", () => {
    const groups = new Map<string, RunRecord[]>();
    for (const r of db.runs) if (r.comparisonId) groups.set(r.comparisonId, [...(groups.get(r.comparisonId) ?? []), r]);
    // Cada grupo tem ao menos uma execução: ele só é criado ao encontrar uma.
    return [...groups.entries()]
      .flatMap(([id, runs]) =>
        runs[0]
          ? [{ id, input: runs[0].input, startedAt: runs[0].startedAt, count: runs.length, done: runs.every((r) => r.finishedAt) }]
          : [],
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 20);
  });

  route("GET", "/api/compare/:id", ({ id }) => {
    const runs = db.runs.filter((r) => r.comparisonId === id);
    const first = runs[0] ?? notFound("Comparação");
    return { id, input: first.input, startedAt: first.startedAt, done: runs.every((r) => r.finishedAt), results: runs.map(runMetrics) };
  });
});
