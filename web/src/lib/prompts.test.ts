import { describe, expect, it } from "vitest";
import type { PromptTemplate } from "./api";
import { fillPrompt, promptVariables, taskPromptsFor, variableLabel } from "./prompts";

const prompt = (p: Partial<PromptTemplate>): PromptTemplate => ({
  id: "p",
  name: "x",
  description: "",
  content: "",
  category: "task",
  agentIds: [],
  createdAt: "",
  ...p,
});

describe("prompts de tarefa", () => {
  it("encontra as variáveis na ordem, sem repetir, aceitando espaços e acentos", () => {
    expect(promptVariables("Converta {{ km }} km e depois {{km}} de novo para {{destinação}}")).toEqual(["km", "destinação"]);
    expect(promptVariables("Sem variáveis")).toEqual([]);
  });

  it("substitui só as variáveis preenchidas", () => {
    expect(fillPrompt("De {{origem}} para {{destino}}", { origem: " Sorocaba ", destino: "" })).toBe("De Sorocaba para {{destino}}");
  });

  it("gera rótulos legíveis", () => {
    expect(variableLabel("valor_mensal")).toBe("Valor mensal");
  });

  it("mostra ao agente os atalhos ligados a ele e os que valem para todos", () => {
    const prompts = [
      prompt({ id: "a", agentIds: ["agt_1"] }),
      prompt({ id: "b", agentIds: ["agt_2"] }),
      prompt({ id: "c" }),
      prompt({ id: "d", category: "system" }),
    ];
    expect(taskPromptsFor(prompts, "agt_1").map((p) => p.id)).toEqual(["a", "c"]);
  });
});
