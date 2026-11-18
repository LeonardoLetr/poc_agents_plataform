import { describe, expect, it, vi } from "vitest";
import { SEED_LLM, migrate, seedDb } from "../seed.js";

describe("dados iniciais", () => {
  it("criam LLMs, agentes válidos e o MCP embutido", () => {
    const db = seedDb();
    const llmIds = new Set(db.llms.map((l) => l.id));
    expect(db.agents.every((a) => llmIds.has(a.llmId))).toBe(true);
    expect(db.mcpServers.map((s) => `${s.name}:${s.transport}`)).toEqual(["laboratorio:builtin"]);
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
    const db = migrate(structuredClone(v1));
    const byId = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    expect(byId.a1?.llmId).toBe(SEED_LLM.opus);
    expect(byId.a3?.llmId).toBe(SEED_LLM.demo);
    const analyst = db.llms.find((l) => l.id === byId.a2?.llmId)!;
    expect(analyst).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", effort: "high", apiKey: "sk-ant-legado" });
    expect(db.llms.find((l) => l.id === SEED_LLM.opus)?.apiKey).toBe("sk-ant-legado");
    expect(byId.a1).not.toHaveProperty("provider");
  });

  it("converte o laboratorio stdio em servidor embutido", () => {
    const db = migrate(structuredClone(v1));
    expect(db.mcpServers[0]).toMatchObject({ transport: "builtin", command: "laboratorio" });
  });

  it("dados vazios geram o conjunto inicial", () => {
    expect(migrate({}).agents.length).toBeGreaterThan(0);
  });
});

describe("migração para a versão 3 (multiagente)", () => {
  const v2 = () => {
    const db = seedDb();
    return { ...db, version: 2, agents: db.agents.filter((a) => a.name !== "Coordenador (offline)") };
  };

  it("adiciona o coordenador delegando ao agente demo existente", () => {
    const data = v2();
    const demo = data.agents.find((a) => a.name === "Agente Demo (offline)")!;
    const db = migrate(structuredClone(data));
    const coordinator = db.agents.find((a) => a.name === "Coordenador (offline)");
    expect(coordinator?.tools).toContain(`agent__${demo.id}`);
    expect(db.version).toBe(11);
  });

  it("não duplica o coordenador nem o cria sem o agente demo", () => {
    const twice = migrate(migrate(structuredClone(v2())));
    expect(twice.agents.filter((a) => a.name === "Coordenador (offline)")).toHaveLength(1);
    const noDemo = v2();
    noDemo.agents = noDemo.agents.filter((a) => a.name !== "Agente Demo (offline)");
    expect(migrate(structuredClone(noDemo)).agents.some((a) => a.name === "Coordenador (offline)")).toBe(false);
  });
});

describe("migração para a versão 5 (supervisor)", () => {
  it("adiciona o supervisor com Claude delegando ao Pesquisador e ao Analista", () => {
    const fresh = seedDb();
    const data = { ...fresh, version: 4, agents: fresh.agents.filter((a) => a.name !== "Supervisor") };
    const db = migrate(structuredClone(data));
    const supervisor = db.agents.find((a) => a.name === "Supervisor")!;
    const ids = Object.fromEntries(db.agents.map((a) => [a.name, a.id]));
    expect(supervisor.llmId).toBe(SEED_LLM.opus);
    expect(supervisor.tools).toEqual(expect.arrayContaining([`agent__${ids["Pesquisador"]}`, `agent__${ids["Analista de Dados"]}`]));
    expect(migrate(structuredClone(db)).agents.filter((a) => a.name === "Supervisor")).toHaveLength(1);
  });

  it("os dados iniciais já trazem o supervisor", () => {
    const db = seedDb();
    const supervisor = db.agents.find((a) => a.name === "Supervisor")!;
    const targets = supervisor.tools.filter((t) => t.startsWith("agent__")).map((t) => db.agents.find((a) => `agent__${a.id}` === t)?.name);
    expect(targets).toEqual(["Pesquisador", "Analista de Dados"]);
  });
});

describe("migração para a versão 6 (assistente de e-mail)", () => {
  it("liga o assistente ao servidor do Resend já cadastrado, pelo endereço", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      version: 5,
      agents: fresh.agents.filter((a) => a.name !== "Assistente de E-mail"),
      mcpServers: [
        ...fresh.mcpServers,
        {
          id: "mcp_x",
          name: "meu_resend",
          transport: "http" as const,
          url: "https://mcp.resend.com/mcp",
          via: "anthropic" as const,
          enabled: true,
          createdAt: "",
        },
      ],
    };
    const db = migrate(structuredClone(data));
    const agent = db.agents.find((a) => a.name === "Assistente de E-mail")!;
    expect(agent.llmId).toBe(SEED_LLM.opus);
    expect(agent.tools).toContain("mcp__meu_resend__*");
    expect(agent.systemPrompt).toMatch(/Nunca envie um e-mail sem confirmação/);
    expect(agent.systemPrompt).toMatch(/Gmail pelo Zapier/);
    expect(migrate(structuredClone(db)).agents.filter((a) => a.name === "Assistente de E-mail")).toHaveLength(1);
  });

  it("sem servidor cadastrado, usa o nome padrão do modelo pronto (resend)", () => {
    expect(seedDb().agents.find((a) => a.name === "Assistente de E-mail")!.tools).toContain("mcp__resend__*");
  });
});

describe("migração para a versão 7 (assistente de e-mail para qualquer servidor)", () => {
  const v6Prompt = "Você é um assistente que redige e envia e-mails usando as ferramentas do servidor MCP do Resend.\n\nRegras...";
  const base = () => {
    const fresh = seedDb();
    return {
      ...fresh,
      version: 6,
      agents: fresh.agents.map((a) =>
        a.name === "Assistente de E-mail"
          ? { ...a, systemPrompt: v6Prompt, description: "Redige e envia e-mails pelo servidor MCP do Resend." }
          : a,
      ),
    };
  };

  it("atualiza as instruções que o usuário não editou", () => {
    const db = migrate(structuredClone(base()));
    const agent = db.agents.find((a) => a.name === "Assistente de E-mail")!;
    expect(agent.systemPrompt).toMatch(/Gmail pelo Zapier/);
    expect(agent.description).not.toContain("do Resend");
  });

  it("preserva instruções editadas pelo usuário", () => {
    const data = base();
    data.agents = data.agents.map((a) => (a.name === "Assistente de E-mail" ? { ...a, systemPrompt: "Minhas próprias instruções" } : a));
    const db = migrate(structuredClone(data));
    expect(db.agents.find((a) => a.name === "Assistente de E-mail")!.systemPrompt).toBe("Minhas próprias instruções");
  });
});

describe("migração para a versão 8 (referências a servidores MCP apagados)", () => {
  it("remove dos agentes ferramentas de servidores que não existem mais", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      version: 7,
      agents: fresh.agents.map((a) =>
        a.name === "Assistente de E-mail" ? { ...a, tools: ["mcp__resend__*", "mcp__zapier__*", "current_time"] } : a,
      ),
    };
    data.mcpServers = [
      ...data.mcpServers,
      {
        id: "mcp_z",
        name: "zapier",
        transport: "http" as const,
        url: "https://mcp.zapier.com/api/v1/connect",
        via: "anthropic" as const,
        enabled: true,
        createdAt: "",
      },
    ];
    const db = migrate(structuredClone(data));
    expect(db.agents.find((a) => a.name === "Assistente de E-mail")!.tools).toEqual(["mcp__zapier__*", "current_time"]);
    expect(db.agents.find((a) => a.name === "Explorador MCP")!.tools).toContain("mcp__laboratorio__*");
  });
});

describe("migração para a versão 9 (sem servidor local)", () => {
  it("remove servidores stdio e as ferramentas deles dos agentes", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      version: 8,
      mcpServers: [
        ...fresh.mcpServers,
        {
          id: "mcp_e",
          name: "everything",
          transport: "stdio",
          command: "npx",
          args: ["-y", "x"],
          env: { A: "1" },
          enabled: false,
          createdAt: "",
        },
      ],
      agents: fresh.agents.map((a) => (a.name === "Explorador MCP" ? { ...a, tools: [...a.tools, "mcp__everything__*"] } : a)),
    };
    const db = migrate(structuredClone(data));
    expect(db.mcpServers.map((s) => s.name)).toEqual(["laboratorio"]);
    expect(db.agents.find((a) => a.name === "Explorador MCP")!.tools).toEqual(["mcp__laboratorio__*", "calculator"]);
    expect(db.mcpServers[0]).not.toHaveProperty("env");
  });
});

describe("migração para a versão 10 (comparador de mercados)", () => {
  it("adiciona o comparador delegando ao Pesquisador e ao Analista existentes, uma única vez", () => {
    const fresh = seedDb();
    const data = { ...fresh, version: 9, agents: fresh.agents.filter((a) => a.name !== "Comparador de Mercados") };
    const db = migrate(structuredClone(data));
    const agent = db.agents.find((a) => a.name === "Comparador de Mercados");
    const researcher = db.agents.find((a) => a.name === "Pesquisador");
    const analyst = db.agents.find((a) => a.name === "Analista de Dados");
    expect(agent?.llmId).toBe(SEED_LLM.opus);
    expect(agent?.tools).toEqual(
      expect.arrayContaining([`agent__${researcher?.id}`, `agent__${analyst?.id}`, "memory_search", "memory_save"]),
    );
    expect(agent?.systemPrompt).toMatch(/CEP/);
    expect(migrate(structuredClone(db)).agents.filter((a) => a.name === "Comparador de Mercados")).toHaveLength(1);
  });

  it("não adiciona quando o Pesquisador foi removido", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      version: 9,
      agents: fresh.agents.filter((a) => a.name !== "Comparador de Mercados" && a.name !== "Pesquisador"),
    };
    expect(migrate(structuredClone(data)).agents.some((a) => a.name === "Comparador de Mercados")).toBe(false);
  });
});

describe("migração para a versão 11 (prompts de tarefa por agente)", () => {
  it("cria os atalhos ligados aos agentes de exemplo, inclusive o comparador criado na v10, sem duplicar", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      version: 9,
      agents: fresh.agents.filter((a) => a.name !== "Comparador de Mercados"),
      prompts: fresh.prompts.filter((p) => p.category === "system").map((p) => ({ ...p, agentIds: undefined })),
    };
    const db = migrate(structuredClone(data));
    const byName = (name: string) => db.agents.find((a) => a.name === name)?.id;
    expect(db.prompts.find((p) => p.name === "Lista de compras")?.agentIds).toEqual([byName("Comparador de Mercados")]);
    expect(db.prompts.find((p) => p.name === "Juros compostos")?.content).toMatch(/\{\{taxa\}\}/);
    expect(db.prompts.filter((p) => p.category === "system").every((p) => p.agentIds.length === 0)).toBe(true);
    const twice = migrate(structuredClone({ ...db, version: 10 }));
    expect(twice.prompts.filter((p) => p.name === "Lista de compras")).toHaveLength(1);
  });

  it("liga o modelo de pesquisa existente ao Pesquisador", () => {
    const fresh = seedDb();
    const data = { ...fresh, version: 10, prompts: fresh.prompts.map((p) => ({ ...p, agentIds: [] })) };
    const db = migrate(structuredClone(data));
    const researcher = db.agents.find((a) => a.name === "Pesquisador");
    expect(db.prompts.find((p) => p.name === "Tarefa: pesquisa com fontes")?.agentIds).toEqual([researcher?.id]);
  });
});

describe("validação dos dados salvos", () => {
  it("descarta itens inválidos sem perder o resto e completa campos acrescentados depois", () => {
    const fresh = seedDb();
    const data = {
      ...fresh,
      memories: [...fresh.memories, { id: "mem_sem_conteudo", kind: "fact" }, { id: "mem_tipo", kind: "segredo", content: "x" }],
      agents: [...fresh.agents, { id: "agt_antigo", name: "Antigo", llmId: "llm_demo", createdAt: "", updatedAt: "" }],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = migrate(structuredClone(data));
    warn.mockRestore();
    expect(db.memories.map((m) => m.id)).toEqual(fresh.memories.map((m) => m.id));
    expect(db.agents.find((a) => a.id === "agt_antigo")).toMatchObject({
      tools: [],
      maxIterations: 10,
      memory: { autoRecall: true, autoEpisode: true, recallLimit: 5 },
    });
  });

  it("mantém a execução e descarta só os eventos fora do formato", () => {
    const run = {
      id: "run_1",
      agentId: "a",
      agentName: "A",
      input: "oi",
      status: "completed",
      output: "olá",
      error: null,
      iterations: 1,
      usage: { input: 1, output: 1 },
      startedAt: "",
      finishedAt: "",
      messages: [{ role: "user", content: "oi" }],
      systemPrompt: "",
      events: [
        { type: "text.delta", text: "olá", ts: "", seq: 0 },
        { type: "evento.desconhecido", ts: "", seq: 1 },
      ],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = migrate({ ...seedDb(), runs: [run] });
    warn.mockRestore();
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0]?.events.map((e) => e.type)).toEqual(["text.delta"]);
    expect(db.runs[0]?.scratchpad).toEqual([]);
  });
});
