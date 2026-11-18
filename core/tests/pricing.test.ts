import { describe, expect, it } from "vitest";
import { costUsd, priceFor, runCost } from "../llm/catalog.js";
import type { LlmConfig, RunRecord } from "../types.js";

describe("custo estimado", () => {
  it("usa o preço da LLM, depois o do catálogo; a demo não cobra e o resto fica sem estimativa", () => {
    expect(priceFor({ provider: "openai", model: "gpt-x", pricing: { input: 0.4, output: 1.6 } })).toEqual({ input: 0.4, output: 1.6 });
    expect(priceFor({ provider: "anthropic", model: "claude-opus-5-5", pricing: { input: 1, output: 2 } })).toEqual({
      input: 1,
      output: 2,
    });
    expect(priceFor({ provider: "anthropic", model: "claude-opus-5-5" })).toEqual({ input: 4, output: 20 });
    expect(priceFor({ provider: "demo", model: "demo-simulado" })).toEqual({ input: 0, output: 0 });
    expect(priceFor({ provider: "openai", model: "llama3.2" })).toBeNull();
    expect(costUsd({ input: 1_000_000, output: 500_000 }, { input: 0.4, output: 1.6 })).toBeCloseTo(1.2);
  });

  it("estima a execução pelo preço atual da LLM usada", () => {
    const llm = { id: "llm_x", provider: "openai", model: "llama3.2" } as LlmConfig;
    const run = {
      llmId: "llm_x",
      usage: { input: 2_000_000, output: 1_000_000 },
      events: [
        { type: "run.started", runId: "r", agentId: "a", input: "x", provider: "openai", model: "llama3.2", llmName: "x", ts: "", seq: 0 },
      ],
    } as RunRecord;
    expect(runCost(run, [llm])).toBeNull();
    expect(runCost(run, [{ ...llm, pricing: { input: 0.1, output: 0.3 } }])).toBeCloseTo(0.5);
  });
});
