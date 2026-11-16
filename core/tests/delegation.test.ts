import { afterEach, describe, expect, it, vi } from "vitest";
import { bootCore, collectRun, waitFor, type StreamEvent } from "./helpers.js";

type Boot = Awaited<ReturnType<typeof bootCore>>;

async function createAgent(api: Boot["api"], name: string, tools: string[], extra: Record<string, unknown> = {}) {
  const res = await api("POST", "/api/agents", {
    name, llmId: "llm_demo", systemPrompt: "Teste.", tools, maxIterations: 6, requireApproval: false,
    memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 }, ...extra,
  });
  return res.body as { id: string; tools: string[] };
}

const ofType = <T extends StreamEvent["type"]>(events: StreamEvent[], type: T) => events.filter((e) => e.type === type) as Extract<StreamEvent, { type: T }>[];

describe("multiagente: agente como ferramenta", () => {
  it("o coordenador delega ao agente demo e agrega os tokens da execução filha", async () => {
    const { core, api, db } = await bootCore();
    const coordinator = db.agents.find((a) => a.name === "Coordenador (offline)")!;
    const demo = db.agents.find((a) => a.name === "Agente Demo (offline)")!;
    expect(coordinator.tools).toContain(`agent__${demo.id}`);

    const run = await api("POST", "/api/runs", { agentId: coordinator.id, input: "quanto é 12 * 7?" });
    const events = await collectRun(core, run.body.id);
    expect(events.at(-1)?.type).toBe("run.completed");

    const [started] = ofType(events, "delegation.started");
    const [finished] = ofType(events, "delegation.finished");
    expect(started).toMatchObject({ agentId: demo.id, agentName: "Agente Demo (offline)", task: "quanto é 12 * 7?" });
    expect(finished).toMatchObject({ childRunId: started.childRunId, status: "completed" });
    expect(ofType(events, "tool.call").find((e) => e.name === `agent__${demo.id}`)?.source).toBe("agent");

    const parent = db.runs.find((r) => r.id === run.body.id)!;
    const child = db.runs.find((r) => r.id === started.childRunId)!;
    expect(child).toMatchObject({ parentRunId: parent.id, depth: 1, chain: [coordinator.id, demo.id], status: "completed" });
    expect(parent.childRunIds).toEqual([child.id]);
    expect(parent.childUsage).toEqual(child.usage);
    expect(finished.usage).toEqual(child.usage);
    // A resposta da filha (com o resultado da calculadora) volta ao pai.
    expect(parent.output).toContain("84");

    const delegation = db.audit.find((a) => a.type === "agent.delegated" && a.runId === parent.id);
    expect(delegation?.data).toMatchObject({ chain: ["Coordenador (offline)", "Agente Demo (offline)"], depth: 1, childRunId: child.id });
    expect(db.audit.some((a) => a.type === "agent.delegation_finished" && a.runId === parent.id)).toBe(true);
  });

  it("bloqueia delegação circular", async () => {
    const { core, api, db } = await bootCore();
    const a = await createAgent(api, "Agente A", []);
    const b = await createAgent(api, "Agente B", [`agent__${a.id}`]);
    await api("PUT", `/api/agents/${a.id}`, { ...db.agents.find((x) => x.id === a.id)!, tools: [`agent__${b.id}`] });

    const run = await api("POST", "/api/runs", { agentId: a.id, input: "tarefa circular" });
    const events = await collectRun(core, run.body.id);
    expect(events.at(-1)?.type).toBe("run.completed");

    const childId = ofType(events, "delegation.started")[0].childRunId;
    const child = db.runs.find((r) => r.id === childId)!;
    const refused = child.events.find((e) => e.type === "tool.result") as { output: string; isError: boolean };
    expect(refused.isError).toBe(true);
    expect(refused.output).toMatch(/circular/i);
    expect(child.childRunIds ?? []).toEqual([]);
  });

  it("respeita a profundidade máxima", async () => {
    const { core, api, db } = await bootCore();
    const d = await createAgent(api, "Agente D", ["calculator"]);
    const c = await createAgent(api, "Agente C", [`agent__${d.id}`]);
    const b = await createAgent(api, "Agente B", [`agent__${c.id}`]);
    const a = await createAgent(api, "Agente A", [`agent__${b.id}`]);

    const run = await api("POST", "/api/runs", { agentId: a.id, input: "tarefa profunda" });
    await collectRun(core, run.body.id);

    const runC = db.runs.find((r) => r.agentId === c.id)!;
    expect(runC.depth).toBe(2);
    const refused = runC.events.find((e) => e.type === "tool.result") as { output: string; isError: boolean };
    expect(refused.isError).toBe(true);
    expect(refused.output).toMatch(/profundidade/i);
    expect(db.runs.some((r) => r.agentId === d.id)).toBe(false);
  });

  it("cancelar a execução pai cancela a filha", async () => {
    const { core, api, db } = await bootCore();
    const child = await createAgent(api, "Filha com aprovação", ["calculator"], { requireApproval: true });
    const parentAgent = await createAgent(api, "Pai", [`agent__${child.id}`]);

    const run = await api("POST", "/api/runs", { agentId: parentAgent.id, input: "quanto é 2 + 2?" });
    const parentDone = collectRun(core, run.body.id);
    // A filha para aguardando aprovação da calculadora.
    await waitFor(() => db.runs.some((r) => r.agentId === child.id && r.status === "awaiting_approval"));
    await api("POST", `/api/runs/${run.body.id}/cancel`);
    const events = await parentDone;

    expect(events.at(-1)?.type).toBe("run.cancelled");
    await waitFor(() => db.runs.find((r) => r.agentId === child.id)?.status === "cancelled");
  });

  it("expõe agentes em /api/tools, impede autodelegação e limpa referências ao excluir", async () => {
    const { api, db } = await bootCore();
    const target = await createAgent(api, "Alvo", []);
    const owner = await createAgent(api, "Dono", [`agent__${target.id}`]);

    const tools = await api<{ name: string; source: string; label?: string }[]>("GET", "/api/tools");
    expect(tools.body.find((t) => t.name === `agent__${target.id}`)).toMatchObject({ source: "agent", label: "🤖 Alvo" });

    const updated = await api("PUT", `/api/agents/${owner.id}`, { ...db.agents.find((x) => x.id === owner.id)!, tools: [`agent__${owner.id}`, `agent__${target.id}`] });
    expect(updated.body.tools).toEqual([`agent__${target.id}`]);

    await api("DELETE", `/api/agents/${target.id}`);
    expect(db.agents.find((x) => x.id === owner.id)!.tools).toEqual([]);
  });
});

describe("supervisor com LLM real (Anthropic simulada)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const sse = (events: Record<string, unknown>[]) =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  const start = { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } };
  const end = (stop: string) => [{ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } }, { type: "message_stop" }];
  const text = (t: string) => [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } },
    { type: "content_block_stop", index: 0 },
  ];

  it("o Supervisor delega ao Analista de Dados e consolida a resposta", async () => {
    const { core, api, db } = await bootCore();
    await api("PUT", "/api/llms/llm_claude_opus", { ...db.llms.find((l) => l.id === "llm_claude_opus")!, apiKey: "sk-ant-teste-supervisor" });
    const supervisor = db.agents.find((a) => a.name === "Supervisor")!;
    const analyst = db.agents.find((a) => a.name === "Analista de Dados")!;
    let supervisorCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { system: string; tools: { name: string }[] };
      if (body.system.includes("supervisor")) {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          expect(body.tools.map((t) => t.name)).toContain(`agent__${analyst.id}`);
          return sse([start, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_s1", name: `agent__${analyst.id}`, input: {} } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"task":"Calcule 15% de 2400"}' } }, { type: "content_block_stop", index: 0 }, ...end("tool_use")]);
        }
        return sse([start, ...text("Segundo o Analista de Dados, 15% de 2400 é 360."), ...end("end_turn")]);
      }
      return sse([start, ...text("15% de 2400 = 360."), ...end("end_turn")]);
    }));

    const run = await api("POST", "/api/runs", { agentId: supervisor.id, input: "Quanto é 15% de 2400?" });
    const events = await collectRun(core, run.body.id);

    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    const parent = db.runs.find((r) => r.id === run.body.id)!;
    const child = db.runs.find((r) => r.id === parent.childRunIds?.[0])!;
    expect(child).toMatchObject({ agentId: analyst.id, input: "Calcule 15% de 2400", output: "15% de 2400 = 360.", status: "completed" });
    expect(parent.output).toContain("360");
    expect(parent.childUsage).toEqual(child.usage);
  });
});
