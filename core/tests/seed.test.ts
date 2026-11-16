import { describe, expect, it } from "vitest";
import { SEED_LLM, migrate, seedDb } from "../seed.js";

describe("dados iniciais", () => {
  it("criam LLMs, agentes válidos e o MCP embutido", () => {
    const db = seedDb("browser");
    const llmIds = new Set(db.llms.map((l) => l.id));
    expect(db.agents.every((a) => llmIds.has(a.llmId))).toBe(true);
    expect(db.mcpServers.map((s) => `${s.name}:${s.transport}`)).toEqual(["laboratorio:builtin"]);
    expect(seedDb("server").mcpServers.map((s) => s.transport)).toContain("stdio");
  });
});

describe("migração da versão 1", () => {
  const v1 = {
    settings: { anthropicApiKey: "sk-ant-legado" },
    agents: [
      { id: "a1", name: "Opus", provider: "anthropic", model: "claude-opus-5-5", effort: "medium", tools: [] },
      { id: "a2", name: "Analista", provider: "anthropic", model: "claude-opus-5-5", effort: "high", tools: [] },
      { id: "a3", name: "Demo", provider: "demo", model: "demo-simulado", effort: "medium", tools: [] },
    ],
    mcpServers: [{ id: "m1", name: "laboratorio", transport: "stdio", command: "node", args: ["x.ts"], enabled: true }],
    memories: [],
    runs: [],
  };

  it("transforma provedor/modelo dos agentes em LLMs e preserva a chave antiga", () => {
    const db = migrate(structuredClone(v1), "server");
    const byId = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    expect(byId.a1.llmId).toBe(SEED_LLM.opus);
    expect(byId.a3.llmId).toBe(SEED_LLM.demo);
    const analyst = db.llms.find((l) => l.id === byId.a2.llmId)!;
    expect(analyst).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", effort: "high", apiKey: "sk-ant-legado" });
    expect(db.llms.find((l) => l.id === SEED_LLM.opus)?.apiKey).toBe("sk-ant-legado");
    expect("provider" in byId.a1).toBe(false);
  });

  it("converte o laboratorio stdio em servidor embutido", () => {
    const db = migrate(structuredClone(v1), "server");
    expect(db.mcpServers[0]).toMatchObject({ transport: "builtin", command: "laboratorio" });
  });

  it("dados vazios geram o conjunto inicial", () => {
    expect(migrate({}, "browser").agents.length).toBeGreaterThan(0);
  });
});

describe("migração para a versão 3 (multiagente)", () => {
  const v2 = () => {
    const db = seedDb("browser");
    return { ...db, version: 2, agents: db.agents.filter((a) => a.name !== "Coordenador (offline)") };
  };

  it("adiciona o coordenador delegando ao agente demo existente", () => {
    const data = v2();
    const demo = data.agents.find((a) => a.name === "Agente Demo (offline)")!;
    const db = migrate(structuredClone(data), "browser");
    const coordinator = db.agents.find((a) => a.name === "Coordenador (offline)");
    expect(coordinator?.tools).toContain(`agent__${demo.id}`);
    expect(db.version).toBe(4);
  });

  it("não duplica o coordenador nem o cria sem o agente demo", () => {
    const twice = migrate(migrate(structuredClone(v2()), "browser") as never, "browser");
    expect(twice.agents.filter((a) => a.name === "Coordenador (offline)")).toHaveLength(1);
    const noDemo = v2();
    noDemo.agents = noDemo.agents.filter((a) => a.name !== "Agente Demo (offline)");
    expect(migrate(structuredClone(noDemo), "browser").agents.some((a) => a.name === "Coordenador (offline)")).toBe(false);
  });
});
