import { describe, expect, it } from "vitest";
import type { RunEvent } from "./api";
import { childActivity, emptyRun, latestChildRuns, reduceRun } from "./runState";

const ts = "2026-01-01T00:00:00.000Z";
const run = (...events: RunEvent[]) => events.reduce(reduceRun, emptyRun);
const started: RunEvent = {
  type: "run.started",
  runId: "r",
  agentId: "a",
  input: "x",
  provider: "demo",
  model: "demo",
  llmName: "Demo",
  ts,
};
const iteration: RunEvent = { type: "iteration.started", iteration: 1, ts };

describe("atividade de uma execução filha", () => {
  it("mostra que o modelo está pensando e depois as ferramentas em execução", () => {
    expect(childActivity(run(started, iteration))).toEqual({ label: "pensando…", busy: true });
    const call: RunEvent = { type: "tool.call", id: "t1", name: "mcp__lab__dados_rolar", input: {}, source: "mcp", server: "lab", ts };
    expect(childActivity(run(started, iteration, call))).toEqual({ label: "dados_rolar", busy: true });
  });

  it("indica espera por aprovação e o desfecho", () => {
    const call: RunEvent = { type: "tool.call", id: "t1", name: "calculator", input: {}, source: "builtin", ts };
    const ask: RunEvent = { type: "tool.approval_requested", id: "t1", name: "calculator", input: {}, ts };
    expect(childActivity(run(started, iteration, call, ask)).label).toBe("aguardando aprovação");
    const done: RunEvent = { type: "run.completed", output: "ok", iterations: 1, usage: { input: 1, output: 1 }, ts };
    expect(childActivity(run(started, iteration, done))).toEqual({ label: "concluída", busy: false });
  });

  it("guarda a execução filha mais recente de cada agente delegado", () => {
    const call = (id: string): RunEvent => ({ type: "tool.call", id, name: "agent__b", input: { task: "x" }, source: "agent", ts });
    const delegated = (toolUseId: string, childRunId: string): RunEvent => ({
      type: "delegation.started",
      toolUseId,
      childRunId,
      agentId: "b",
      agentName: "B",
      task: "x",
      ts,
    });
    const view = run(started, iteration, call("t1"), delegated("t1", "run_1"), iteration, call("t2"), delegated("t2", "run_2"));
    expect(latestChildRuns(view.steps).get("agent__b")).toBe("run_2");
  });
});
