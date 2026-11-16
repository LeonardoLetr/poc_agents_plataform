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
    expect(db.version).toBe(6);
  });

  it("não duplica o coordenador nem o cria sem o agente demo", () => {
    const twice = migrate(migrate(structuredClone(v2()), "browser") as never, "browser");
    expect(twice.agents.filter((a) => a.name === "Coordenador (offline)")).toHaveLength(1);
    const noDemo = v2();
    noDemo.agents = noDemo.agents.filter((a) => a.name !== "Agente Demo (offline)");
    expect(migrate(structuredClone(noDemo), "browser").agents.some((a) => a.name === "Coordenador (offline)")).toBe(false);
  });
});

describe("migração para a versão 5 (supervisor)", () => {
  it("adiciona o supervisor com Claude delegando ao Pesquisador e ao Analista", () => {
    const fresh = seedDb("browser");
    const data = { ...fresh, version: 4, agents: fresh.agents.filter((a) => a.name !== "Supervisor") };
    const db = migrate(structuredClone(data), "browser");
    const supervisor = db.agents.find((a) => a.name === "Supervisor")!;
    const ids = Object.fromEntries(db.agents.map((a) => [a.name, a.id]));
    expect(supervisor.llmId).toBe(SEED_LLM.opus);
    expect(supervisor.tools).toEqual(expect.arrayContaining([`agent__${ids["Pesquisador"]}`, `agent__${ids["Analista de Dados"]}`]));
    expect(migrate(structuredClone(db) as never, "browser").agents.filter((a) => a.name === "Supervisor")).toHaveLength(1);
  });

  it("os dados iniciais já trazem o supervisor", () => {
    const db = seedDb("server");
    const supervisor = db.agents.find((a) => a.name === "Supervisor")!;
    const targets = supervisor.tools.filter((t) => t.startsWith("agent__")).map((t) => db.agents.find((a) => `agent__${a.id}` === t)?.name);
    expect(targets).toEqual(["Pesquisador", "Analista de Dados"]);
  });
});

describe("migração para a versão 6 (assistente de e-mail)", () => {
  it("liga o assistente ao servidor do Resend já cadastrado, pelo endereço", () => {
    const fresh = seedDb("browser");
    const data = {
      ...fresh,
      version: 5,
      agents: fresh.agents.filter((a) => a.name !== "Assistente de E-mail"),
      mcpServers: [...fresh.mcpServers, { id: "mcp_x", name: "meu_resend", transport: "http" as const, url: "https://mcp.resend.com/mcp", via: "anthropic" as const, enabled: true, createdAt: "" }],
    };
    const db = migrate(structuredClone(data), "browser");
    const agent = db.agents.find((a) => a.name === "Assistente de E-mail")!;
    expect(agent.llmId).toBe(SEED_LLM.opus);
    expect(agent.tools).toContain("mcp__meu_resend__*");
    expect(agent.systemPrompt).toMatch(/Nunca envie um e-mail sem confirmação/);
    expect(migrate(structuredClone(db) as never, "browser").agents.filter((a) => a.name === "Assistente de E-mail")).toHaveLength(1);
  });

  it("sem servidor cadastrado, usa o nome padrão do modelo pronto (resend)", () => {
    expect(seedDb("browser").agents.find((a) => a.name === "Assistente de E-mail")!.tools).toContain("mcp__resend__*");
  });
});
