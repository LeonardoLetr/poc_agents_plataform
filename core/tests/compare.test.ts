import { beforeAll, describe, expect, it } from "vitest";
import { bootCore, waitFor } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;
let calcAgent = "";
let mcpAgent = "";

beforeAll(async () => {
  ctx = await bootCore();
  await waitFor(async () => (await ctx.api("GET", "/api/mcp")).body.some((s: any) => s.state.status === "connected"), 5000, "MCP");
  const mk = async (name: string, tools: string[]) =>
    (await ctx.api("POST", "/api/agents", { name, llmId: "llm_demo", tools, memory: { autoRecall: false, autoEpisode: false, recallLimit: 0 } })).body.id;
  calcAgent = await mk("Só calculadora", ["calculator"]);
  mcpAgent = await mk("Calculadora + MCP", ["calculator", "mcp__laboratorio__*"]);
});

const finished = (id: string) => waitFor(async () => (await ctx.api("GET", `/api/compare/${id}`)).body.done, 8000, "comparação concluída");

describe("comparação lado a lado", () => {
  it("executa todas as combinações em paralelo e consolida as métricas", async () => {
    const start = await ctx.api("POST", "/api/compare", { input: "Quanto é 6 * 7? Role 2d6", entries: [{ agentId: calcAgent }, { agentId: mcpAgent }] });
    expect(start.status).toBe(201);
    expect(start.body.runIds).toHaveLength(2);
    await finished(start.body.id);

    const { body } = await ctx.api("GET", `/api/compare/${start.body.id}`);
    expect(body.input).toBe("Quanto é 6 * 7? Role 2d6");
    const [calc, mcp] = body.results;
    expect(calc).toMatchObject({ agentName: "Só calculadora", status: "completed", toolCalls: 1, tools: ["calculator"], provider: "demo" });
    expect(mcp).toMatchObject({ agentName: "Calculadora + MCP", status: "completed", toolCalls: 2 });
    expect(mcp.tools).toContain("mcp__laboratorio__dados_rolar");
    for (const r of body.results) {
      expect(r.tokens.total).toBe(r.tokens.input + r.tokens.output);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.costUsd).toBeNull(); // modelo demo não tem preço
      expect(r.output).toContain("42");
    }
  });

  it("troca a LLM só na execução, sem alterar o agente", async () => {
    const start = await ctx.api("POST", "/api/compare", {
      input: "oi",
      entries: [{ agentId: calcAgent }, { agentId: calcAgent, llmId: "llm_claude_haiku" }],
    });
    await finished(start.body.id);
    const { body } = await ctx.api("GET", `/api/compare/${start.body.id}`);
    expect(body.results[0]).toMatchObject({ llmId: "llm_demo", status: "completed" });
    expect(body.results[1]).toMatchObject({ llmId: "llm_claude_haiku", model: "claude-haiku-5-5", status: "failed" }); // sem chave
    expect((await ctx.api("GET", `/api/agents/${calcAgent}`)).body.llmId).toBe("llm_demo");
  });

  it("lista as comparações mais recentes primeiro", async () => {
    const { body } = await ctx.api("GET", "/api/compare");
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0]?.input).toBe("oi");
    expect(body[0]).toMatchObject({ count: 2, done: true });
  });

  it("valida a quantidade de combinações e as referências", async () => {
    expect((await ctx.api("POST", "/api/compare", { input: "x", entries: [{ agentId: calcAgent }] })).status).toBe(400);
    const five = Array.from({ length: 5 }, () => ({ agentId: calcAgent }));
    expect((await ctx.api("POST", "/api/compare", { input: "x", entries: five })).status).toBe(400);
    expect((await ctx.api("POST", "/api/compare", { input: "x", entries: [{ agentId: calcAgent }, { agentId: "agt_fantasma" }] })).status).toBe(404);
    expect((await ctx.api("POST", "/api/compare", { input: "x", entries: [{ agentId: calcAgent }, { agentId: calcAgent, llmId: "llm_fantasma" }] })).status).toBe(404);
    expect((await ctx.api("GET", "/api/compare/cmp_inexistente")).status).toBe(404);
  });
});
