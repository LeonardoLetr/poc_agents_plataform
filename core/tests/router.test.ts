import { beforeAll, describe, expect, it } from "vitest";
import { bootCore } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;
beforeAll(async () => {
  ctx = await bootCore();
});

describe("API: sistema", () => {
  it("informa capacidades e catálogo de modelos", async () => {
    const { status, body } = await ctx.api("GET", "/api/health");
    expect(status).toBe(200);
    expect(body.capabilities.builtinMcp).toContain("laboratorio");
    expect(body.catalog.anthropic.map((m: { id: string }) => m.id)).toContain("claude-opus-5-5");
  });

  it("responde 404 para rotas inexistentes", async () => {
    expect((await ctx.api("GET", "/api/nada")).status).toBe(404);
  });
});

describe("API: LLMs", () => {
  const secret = "sk-ant-segredo-1234";
  let id = "";

  it("cria uma LLM sem nunca devolver a chave", async () => {
    const res = await ctx.api("POST", "/api/llms", {
      name: "Claude teste",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      apiKey: secret,
    });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(res.body.apiKeySet).toBe(true);
    expect(res.body.apiKeyHint).toBe("…1234");
    expect(res.body.ready).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(JSON.stringify((await ctx.api("GET", "/api/llms")).body)).not.toContain(secret);
  });

  it("mantém a chave quando a atualização não envia apiKey e remove com string vazia", async () => {
    const kept = await ctx.api("PUT", `/api/llms/${id}`, { name: "Claude renomeado", provider: "anthropic", model: "claude-haiku-5-5" });
    expect(kept.body.apiKeySet).toBe(true);
    const removed = await ctx.api("PUT", `/api/llms/${id}`, {
      name: "Claude renomeado",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      apiKey: "",
    });
    expect(removed.body.apiKeySet).toBe(false);
    expect(removed.body.ready).toBe(false); // sem chave própria e sem variável de ambiente
  });

  it("valida os dados de entrada", async () => {
    const res = await ctx.api("POST", "/api/llms", { name: "", provider: "inexistente", model: "" });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("impede remover uma LLM usada por agentes", async () => {
    const res = await ctx.api("DELETE", "/api/llms/llm_demo");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Agente Demo/);
  });

  it("remove uma LLM sem uso", async () => {
    expect((await ctx.api("DELETE", `/api/llms/${id}`)).status).toBe(200);
  });
});

describe("API: agentes", () => {
  it("cria, atualiza e registra a mudança na auditoria", async () => {
    const created = await ctx.api("POST", "/api/agents", { name: "Agente de teste", llmId: "llm_demo", tools: ["calculator"] });
    expect(created.status).toBe(201);
    const updated = await ctx.api("PUT", `/api/agents/${created.body.id}`, { ...created.body, maxIterations: 3 });
    expect(updated.body.maxIterations).toBe(3);
    const entry = ctx.db.audit.find((a) => a.summary.includes("Agente de teste") && a.summary.includes("atualizado"));
    expect(entry?.summary).toMatch(/maxIterations/);
  });

  it("rejeita agente com LLM inexistente e com dados inválidos", async () => {
    expect((await ctx.api("POST", "/api/agents", { name: "X", llmId: "llm_fantasma" })).status).toBe(404);
    expect((await ctx.api("POST", "/api/agents", { name: "", llmId: "" })).status).toBe(400);
  });
});

describe("API: ferramentas", () => {
  it("lista as ferramentas nativas com schema", async () => {
    const { body } = await ctx.api("GET", "/api/tools");
    const calc = body.find((t: { name: string }) => t.name === "calculator");
    expect(calc).toMatchObject({ source: "builtin", category: "raciocínio" });
    expect(calc.inputSchema.required).toEqual(["expression"]);
  });
});
