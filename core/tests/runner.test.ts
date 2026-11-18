import { beforeAll, describe, expect, it } from "vitest";
import { hostEnv } from "../env.js";
import { bootCore, collectRun, types, waitFor, type StreamEvent } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;

async function agent(fields: Record<string, unknown>) {
  const res = await ctx.api("POST", "/api/agents", {
    name: "Agente de teste",
    llmId: "llm_demo",
    memory: { autoRecall: false, autoEpisode: false, recallLimit: 0 },
    ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function run(agentId: string, input: string, opts?: Parameters<typeof collectRun>[2]) {
  const res = await ctx.api("POST", "/api/runs", { agentId, input });
  expect(res.status).toBe(201);
  const events = await collectRun(ctx.core, res.body.id, opts);
  return { id: res.body.id as string, events };
}

const toolCalls = (events: StreamEvent[]) => events.filter((e): e is Extract<StreamEvent, { type: "tool.call" }> => e.type === "tool.call");
const toolResults = (events: StreamEvent[]) =>
  events.filter((e): e is Extract<StreamEvent, { type: "tool.result" }> => e.type === "tool.result");

beforeAll(async () => {
  ctx = await bootCore();
  // O servidor MCP embutido conecta de forma assíncrona na inicialização.
  await waitFor(
    async () => (await ctx.api("GET", "/api/mcp")).body.some((s: any) => s.name === "laboratorio" && s.state.status === "connected"),
    5000,
    "MCP laboratorio",
  );
});

describe("loop agêntico com a LLM demo", () => {
  it("executa ferramentas nativas e MCP e conclui com a resposta", async () => {
    const id = await agent({ tools: ["calculator", "mcp__laboratorio__*"] });
    const { events, id: runId } = await run(id, "Quanto é 2 + 3 * 4? Role 2d6");

    expect(types(events)[0]).toBe("run.started");
    expect(types(events).at(-1)).toBe("run.completed");
    const calls = toolCalls(events);
    expect(calls.map((c) => c.name)).toEqual(["calculator", "mcp__laboratorio__dados_rolar"]);
    expect(calls[1]).toMatchObject({ source: "mcp", server: "laboratorio" });
    expect(toolResults(events)[0]?.output).toContain('"result":14');
    expect(toolResults(events).every((r) => !r.isError)).toBe(true);

    const record = (await ctx.api("GET", `/api/runs/${runId}`)).body;
    expect(record.status).toBe("completed");
    expect(record.output).toContain("14");
    expect(record.iterations).toBe(3); // duas ferramentas, uma por iteração, e a resposta final
    // Protocolo de ferramentas: assistant(tool_use) → user(tool_result) alternados no histórico.
    expect(record.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
  });

  it("registra a execução na auditoria", async () => {
    const auditTypes = ctx.db.audit.map((a) => a.type);
    expect(auditTypes).toEqual(
      expect.arrayContaining(["run.started", "llm.request", "llm.response", "tool.call", "tool.result", "run.completed"]),
    );
  });

  it("salva memória episódica e recupera memórias relevantes quando configurado", async () => {
    const id = await agent({ tools: ["calculator"], memory: { autoRecall: true, autoEpisode: true, recallLimit: 3 } });
    const { events } = await run(id, "Para cálculos, usar a calculadora: quanto é 9 * 9?");
    expect(types(events)).toContain("memory.recalled"); // memória semeada sobre "calculator"
    const episode = events.find((e) => e.type === "memory.created");
    expect(episode && "memory" in episode && episode.memory.kind).toBe("episode");
  });

  it("gera episódios curtos e não os usa no recall automático por padrão", async () => {
    const id = await agent({ tools: ["calculator"], memory: { autoRecall: true, autoEpisode: true, recallLimit: 5 } });
    const first = await run(id, "Quanto é 12 * 12 no orçamento?");
    const episode = first.events.find((e) => e.type === "memory.created");
    const content = episode && "memory" in episode ? episode.memory.content : "";
    expect(content.length).toBeLessThanOrEqual(220);
    expect(content).toMatch(/^Tarefa "Quanto é 12 \* 12 no orçamento\?" · 2 iterações · ferramentas: calculator\./);
    expect(content).not.toMatch(/Episódio:/);

    // Mesma pergunta: o episódio anterior não deve ser injetado no contexto.
    const second = await run(id, "Quanto é 12 * 12 no orçamento?");
    const recalled = second.events.find((e) => e.type === "memory.recalled");
    const kinds = recalled && "memories" in recalled ? recalled.memories.map((m) => m.kind) : [];
    expect(kinds).not.toContain("episode");
  });

  it("inclui episódios no recall quando o agente pede", async () => {
    const id = await agent({
      tools: ["calculator"],
      memory: { autoRecall: true, autoEpisode: true, recallLimit: 5, recallEpisodes: true },
    });
    await run(id, "Quanto é 15 * 3 no estoque?");
    const { events } = await run(id, "Quanto é 15 * 3 no estoque?");
    const recalled = events.find((e) => e.type === "memory.recalled");
    expect(recalled && "memories" in recalled && recalled.memories.some((m) => m.kind === "episode")).toBe(true);
  });

  it("pede aprovação humana e respeita a negação", async () => {
    const id = await agent({ tools: ["calculator"], requireApproval: true });
    const res = await ctx.api("POST", "/api/runs", { agentId: id, input: "quanto é 1 + 1?" });
    const events = await collectRun(ctx.core, res.body.id, {
      onEvent: (e) => {
        if (e.type === "tool.approval_requested") {
          void ctx.api("POST", `/api/runs/${res.body.id}/approve`, { toolUseId: e.id, approved: false });
        }
      },
    });
    expect(types(events)).toEqual(expect.arrayContaining(["tool.approval_requested", "tool.approval_resolved"]));
    const result = toolResults(events)[0];
    expect(result?.isError).toBe(true);
    expect(result?.output).toMatch(/NEGOU/);
    expect(types(events).at(-1)).toBe("run.completed");
  });

  it("pede aprovação só para a ferramenta marcada e nunca oferece a bloqueada", async () => {
    const id = await agent({
      tools: ["calculator", "current_time", "memory_save"],
      toolPolicies: { calculator: "ask", memory_save: "block" },
    });
    const res = await ctx.api("POST", "/api/runs", { agentId: id, input: "quanto é 2 + 2 e que horas são? lembre que prefiro chá" });
    const asked: string[] = [];
    const events = await collectRun(ctx.core, res.body.id, {
      onEvent: (e) => {
        if (e.type === "tool.approval_requested") {
          asked.push(e.name);
          void ctx.api("POST", `/api/runs/${res.body.id}/approve`, { toolUseId: e.id, approved: true });
        }
      },
    });
    expect(asked).toEqual(["calculator"]);
    expect(toolCalls(events).map((c) => c.name)).toEqual(["calculator", "current_time"]);
    const request = events.find((e) => e.type === "llm.request");
    expect(request && "toolCount" in request && request.toolCount).toBe(2);
    expect(types(events).at(-1)).toBe("run.completed");
  });

  it("interrompe ao atingir o limite de iterações", async () => {
    const id = await agent({ tools: ["scratchpad_write", "calculator"], maxIterations: 1 });
    const { events } = await run(id, "quanto é 5 * 5?");
    const failed = events.at(-1);
    expect(failed?.type).toBe("run.failed");
    expect(failed && "error" in failed && failed.error).toMatch(/Limite de 1 iterações/);
  });

  it("falha com mensagem clara quando a LLM não tem chave", async () => {
    const id = await agent({ llmId: "llm_claude_opus", tools: [] });
    const { events } = await run(id, "olá");
    const failed = events.at(-1);
    expect(failed?.type).toBe("run.failed");
    expect(failed && "error" in failed && failed.error).toMatch(/não tem chave de API/);
  });

  it("continua a conversa mantendo o histórico (memória de curto prazo)", async () => {
    const id = await agent({ tools: ["calculator"] });
    const first = await run(id, "quanto é 10 / 4?");
    const pending = collectRun(ctx.core, first.id, { ignoreSnapshot: true });
    expect((await ctx.api("POST", `/api/runs/${first.id}/messages`, { text: "e quanto é 3 * 3?" })).status).toBe(200);
    const second = await pending;
    expect(types(second)[0]).toBe("user.message");
    expect(toolResults(second)[0]?.output).toContain('"result":9');
    const record = (await ctx.api("GET", `/api/runs/${first.id}`)).body;
    expect(
      record.messages.filter((m: { role: string; content: unknown }) => m.role === "user" && typeof m.content === "string"),
    ).toHaveLength(2);
  });

  it("cancela uma execução em andamento", async () => {
    hostEnv.demoDelayScale = 1; // precisa de tempo para cancelar no meio
    try {
      const id = await agent({ tools: ["calculator"] });
      const res = await ctx.api("POST", "/api/runs", { agentId: id, input: "quanto é 7 * 8?" });
      const events = await collectRun(ctx.core, res.body.id, {
        onEvent: (e) => {
          if (e.type === "iteration.started") void ctx.api("POST", `/api/runs/${res.body.id}/cancel`);
        },
      });
      expect(types(events).at(-1)).toBe("run.cancelled");
      expect((await ctx.api("GET", `/api/runs/${res.body.id}`)).body.status).toBe("cancelled");
    } finally {
      hostEnv.demoDelayScale = 0;
    }
  });
});
