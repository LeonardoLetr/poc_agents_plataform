import { describe, expect, it } from "vitest";
import { turnOutcome } from "../agent/turn.js";
import type { Block } from "../llm/types.js";

const text = (t: string): Block => ({ type: "text", text: t });
const toolUse = (id: string): Block => ({ type: "tool_use", id, name: "calculator", input: { expression: "2+2" } });

describe("desfecho de um turno", () => {
  it("entrega a resposta final quando o modelo termina sem pedir ferramentas", () => {
    expect(turnOutcome({ content: [text("São 4.")], stopReason: "end_turn" }, "")).toEqual({ kind: "final", text: "São 4." });
  });

  it("pede a execução das ferramentas locais solicitadas", () => {
    const outcome = turnOutcome({ content: [text("Vou calcular."), toolUse("a"), toolUse("b")], stopReason: "tool_use" }, "");
    expect(outcome.kind).toBe("tools");
    expect(outcome.kind === "tools" && outcome.toolUses.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("retoma turnos pausados e junta o texto deles à resposta final", () => {
    const paused = turnOutcome({ content: [text("Parte 1.")], stopReason: "pause_turn" }, "");
    expect(paused).toEqual({ kind: "resume", carried: "Parte 1." });
    const final = turnOutcome({ content: [text("Parte 2.")], stopReason: "end_turn" }, "Parte 1.");
    expect(final).toEqual({ kind: "final", text: "Parte 1.\n\nParte 2." });
  });

  it("falha na recusa e quando a entrada de uma ferramenta foi truncada", () => {
    expect(turnOutcome({ content: [], stopReason: "refusal" }, "").kind).toBe("failed");
    expect(turnOutcome({ content: [toolUse("a")], stopReason: "max_tokens" }, "").kind).toBe("failed");
    // Sem ferramentas, max_tokens só corta o texto: a resposta parcial é entregue.
    expect(turnOutcome({ content: [text("Resposta cortada")], stopReason: "max_tokens" }, "")).toEqual({
      kind: "final",
      text: "Resposta cortada",
    });
  });

  it("usa como resposta só o texto depois do último resultado de ferramenta de servidor", () => {
    const content: Block[] = [
      text("Vou buscar."),
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "mcp" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      text("O MCP padroniza ferramentas."),
    ];
    expect(turnOutcome({ content, stopReason: "end_turn" }, "")).toEqual({ kind: "final", text: "O MCP padroniza ferramentas." });
  });
});
