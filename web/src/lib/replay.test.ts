import { describe, expect, it } from "vitest";
import type { RunEvent } from "./api";
import { iterationAt, iterationStarts, jumpIteration, replayDelay, viewAt } from "./replay";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const events: RunEvent[] = [
  { type: "run.started", runId: "r", agentId: "a", input: "quanto é 2+2?", provider: "demo", model: "demo", ts: at(0) },
  { type: "iteration.started", iteration: 1, ts: at(1) },
  { type: "text.delta", text: "Vou calcular.", ts: at(2) },
  {
    type: "llm.response",
    iteration: 1,
    stopReason: "tool_use",
    usage: { input: 100, output: 10 },
    durationMs: 900,
    model: "demo",
    ts: at(3),
  },
  { type: "tool.call", id: "t1", name: "calculator", input: { expression: "2+2" }, source: "builtin", ts: at(3) },
  { type: "tool.result", id: "t1", name: "calculator", output: "4", isError: false, durationMs: 2, ts: at(3) },
  { type: "iteration.started", iteration: 2, ts: at(30) },
  {
    type: "llm.response",
    iteration: 2,
    stopReason: "end_turn",
    usage: { input: 150, output: 20 },
    durationMs: 800,
    model: "demo",
    ts: at(31),
  },
  { type: "run.completed", output: "4", iterations: 2, usage: { input: 250, output: 30 }, ts: at(32) },
];

describe("replay de execuções", () => {
  it("reconstrói o estado em qualquer posição", () => {
    expect(viewAt(events, 0).status).toBe("idle");
    const mid = viewAt(events, 5);
    expect(mid.iteration).toBe(1);
    expect(mid.callCounts).toEqual({ "tool:calculator": 1 });
    expect(mid.status).toBe("running");
    const end = viewAt(events, events.length);
    expect(end.status).toBe("completed");
    expect(end.tokens).toEqual({ input: 250, output: 30 });
  });

  it("navega por iteração", () => {
    expect(iterationStarts(events)).toEqual([2, 7]);
    expect(jumpIteration(events, 0, 1)).toBe(2);
    expect(jumpIteration(events, 2, 1)).toBe(7);
    expect(jumpIteration(events, 7, 1)).toBe(events.length);
    expect(jumpIteration(events, 7, -1)).toBe(2);
    expect(jumpIteration(events, 2, -1)).toBe(0);
    expect(iterationAt(events, 4)).toBe(1);
    expect(iterationAt(events, 8)).toBe(2);
  });

  it("respeita a velocidade e limita pausas longas", () => {
    expect(replayDelay(events, 2, 1)).toBe(1000);
    expect(replayDelay(events, 2, 4)).toBe(250);
    expect(replayDelay(events, 5, 1)).toBe(80); // eventos no mesmo instante
    expect(replayDelay(events, 6, 1)).toBe(1500); // 27 s de espera viram 1,5 s
  });
});
