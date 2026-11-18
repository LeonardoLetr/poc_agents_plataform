import { z } from "zod";
import { EFFORTS, PROVIDERS } from "../types.js";
import { audit } from "../audit.js";
import { publicLlm } from "../llm/index.js";
import { newLlm } from "../seed.js";
import { db, persist } from "../store.js";
import { now } from "../util.js";
import { defineRoutes, HttpError, notFound } from "./http.js";

const LlmInput = z.object({
  name: z.string().min(1).max(60),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  /** undefined = manter a chave atual · "" = remover */
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  effort: z.enum(EFFORTS).default("medium"),
  refusalFallback: z.boolean().default(true),
  maxTokens: z.number().int().min(256).max(128000).optional(),
  contextWindow: z.number().int().min(1000).max(10_000_000).optional(),
  pricing: z.object({ input: z.number().min(0), output: z.number().min(0) }).optional(),
});

/** Falha com 404 se a LLM não existe. */
export const checkLlm = (llmId: string) => db.llms.some((l) => l.id === llmId) || notFound("LLM");

export const llmRoutes = defineRoutes((route) => {
  route("GET", "/api/llms", () =>
    db.llms.map((l) => ({ ...publicLlm(l), agents: db.agents.filter((a) => a.llmId === l.id).map((a) => a.id) })),
  );

  route(
    "POST",
    "/api/llms",
    (_p, req) => {
      const body = LlmInput.parse(req.body);
      const { maxTokens, ...fields } = body;
      const llm = newLlm({ ...fields, apiKey: body.apiKey?.trim() || undefined, baseUrl: body.baseUrl?.trim() || undefined });
      if (maxTokens) llm.maxTokens = maxTokens;
      db.llms.push(llm);
      persist();
      audit({
        type: "config.changed",
        actor: "user",
        summary: `LLM "${llm.name}" criada (${llm.provider} · ${llm.model})`,
        data: publicLlm(llm),
      });
      return publicLlm(llm);
    },
    { created: true },
  );

  route("PUT", "/api/llms/:id", ({ id }, req) => {
    const llm = db.llms.find((l) => l.id === id) ?? notFound("LLM");
    const body = LlmInput.parse(req.body);
    const before = publicLlm(llm);
    Object.assign(llm, {
      name: body.name,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl?.trim() || undefined,
      effort: body.effort,
      refusalFallback: body.refusalFallback,
      maxTokens: body.maxTokens ?? llm.maxTokens,
      contextWindow: body.contextWindow,
      pricing: body.pricing,
      updatedAt: now(),
    });
    if (body.apiKey !== undefined) llm.apiKey = body.apiKey.trim() || undefined;
    persist();
    audit({
      type: "config.changed",
      actor: "user",
      summary: `LLM "${llm.name}" atualizada${body.apiKey !== undefined ? (body.apiKey ? " (chave trocada)" : " (chave removida)") : ""}`,
      data: { before, after: publicLlm(llm) },
    });
    return publicLlm(llm);
  });

  route("DELETE", "/api/llms/:id", ({ id }) => {
    const removed = db.llms.find((l) => l.id === id) ?? notFound("LLM");
    const users = db.agents.filter((a) => a.llmId === id);
    if (users.length)
      throw new HttpError(409, `Esta LLM é usada por: ${users.map((a) => a.name).join(", ")}. Troque a LLM desses agentes antes.`);
    db.llms.splice(db.llms.indexOf(removed), 1);
    persist();
    audit({ type: "config.changed", actor: "user", summary: `LLM "${removed.name}" removida` });
    return { ok: true };
  });
});
