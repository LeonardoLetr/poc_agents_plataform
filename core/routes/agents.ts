import { z } from "zod";
import { audit } from "../audit.js";
import { db, persist } from "../store.js";
import { agentToolName } from "../agent/delegation.js";
import { type AgentConfig } from "../types.js";
import { now, uid } from "../util.js";
import { defineRoutes, notFound } from "./http.js";
import { checkLlm } from "./llms.js";

const AgentInput = z.object({
  name: z.string().min(1).max(60),
  emoji: z.string().max(8).default("🤖"),
  color: z.string().default("#8b5cf6"),
  description: z.string().max(400).default(""),
  llmId: z.string().min(1, "Escolha uma LLM"),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(50).default(10),
  requireApproval: z.boolean().default(false),
  toolPolicies: z.record(z.string(), z.enum(["allow", "ask", "block"])).default({}),
  memory: z
    .object({
      autoRecall: z.boolean(),
      autoEpisode: z.boolean(),
      recallLimit: z.number().int().min(0).max(20),
      recallEpisodes: z.boolean().optional(),
    })
    .default({ autoRecall: true, autoEpisode: true, recallLimit: 5 }),
  context: z.object({ autoCompact: z.boolean(), thresholdPct: z.number().int().min(5).max(95) }).optional(),
});

export const agentRoutes = defineRoutes((route) => {
  route("GET", "/api/agents", () => db.agents);

  route("GET", "/api/agents/:id", ({ id }) => db.agents.find((a) => a.id === id) ?? notFound("Agente"));

  route(
    "POST",
    "/api/agents",
    (_p, req) => {
      const body = AgentInput.parse(req.body);
      checkLlm(body.llmId);
      const agent: AgentConfig = { id: uid("agt"), ...body, createdAt: now(), updatedAt: now() };
      db.agents.push(agent);
      persist();
      audit({ type: "config.changed", actor: "user", agentId: agent.id, summary: `Agente "${agent.name}" criado`, data: agent });
      return agent;
    },
    { created: true },
  );

  route("PUT", "/api/agents/:id", ({ id }, req) => {
    const agent = db.agents.find((a) => a.id === id) ?? notFound("Agente");
    const body = AgentInput.parse(req.body);
    checkLlm(body.llmId);
    body.tools = body.tools.filter((t) => t !== agentToolName(agent.id)); // um agente não delega a si mesmo
    const before = structuredClone(agent);
    Object.assign(agent, body, { updatedAt: now() });
    persist();
    const changed = Object.keys(body).filter((k) => JSON.stringify(Reflect.get(before, k)) !== JSON.stringify(Reflect.get(agent, k)));
    audit({
      type: "config.changed",
      actor: "user",
      agentId: agent.id,
      summary: `Agente "${agent.name}" atualizado (${changed.join(", ") || "sem mudanças"})`,
      data: { before, after: agent },
    });
    return agent;
  });

  route("DELETE", "/api/agents/:id", ({ id }) => {
    const removed = db.agents.find((a) => a.id === id) ?? notFound("Agente");
    db.agents.splice(db.agents.indexOf(removed), 1);
    // Remove a delegação para o agente excluído dos demais.
    for (const a of db.agents) a.tools = a.tools.filter((t) => t !== agentToolName(removed.id));
    persist();
    audit({ type: "config.changed", actor: "user", agentId: removed.id, summary: `Agente "${removed.name}" removido` });
    return { ok: true };
  });
});
