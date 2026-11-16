import { beforeAll, describe, expect, it } from "vitest";
import { bootCore, waitFor } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;
let labId = "";

beforeAll(async () => {
  ctx = await bootCore();
  await waitFor(
    async () => {
      const lab = (await ctx.api("GET", "/api/mcp")).body.find((s: any) => s.name === "laboratorio");
      labId = lab?.id ?? "";
      return lab?.state.status === "connected";
    },
    5000,
    "MCP laboratorio",
  );
});

describe("MCP: servidor embutido", () => {
  it("descobre as ferramentas via tools/list com nomes qualificados", async () => {
    const lab = (await ctx.api("GET", "/api/mcp")).body.find((s: any) => s.id === labId);
    expect(lab.state.serverInfo).toEqual({ name: "laboratorio", version: "1.0.0" });
    expect(lab.state.tools.map((t: any) => t.qualifiedName)).toEqual([
      "mcp__laboratorio__notas_adicionar",
      "mcp__laboratorio__notas_listar",
      "mcp__laboratorio__dados_rolar",
      "mcp__laboratorio__texto_estatisticas",
      "mcp__laboratorio__unidades_converter",
    ]);
  });

  it("executa tools/call e devolve o resultado", async () => {
    const res = await ctx.api("POST", `/api/mcp/${labId}/tools/unidades_converter/call`, { arguments: { valor: 100, conversao: "c->f" } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.text)).toMatchObject({ resultado: 212, unidade: "°F" });
    expect(res.body.isError).toBe(false);
  });

  it("mantém estado no servidor entre chamadas", async () => {
    await ctx.api("POST", `/api/mcp/${labId}/tools/notas_adicionar/call`, { arguments: { texto: "primeira" } });
    const list = await ctx.api("POST", `/api/mcp/${labId}/tools/notas_listar/call`, { arguments: {} });
    expect(JSON.parse(list.body.text)).toEqual([expect.objectContaining({ id: 1, text: "primeira" })]);
  });

  it("sinaliza argumentos inválidos como erro da ferramenta", async () => {
    const res = await ctx.api("POST", `/api/mcp/${labId}/tools/dados_rolar/call`, { arguments: { notacao: "muitos dados" } });
    expect(res.status === 400 || res.body.isError).toBe(true);
  });

  it("expõe as ferramentas MCP na lista geral", async () => {
    const tools = (await ctx.api("GET", "/api/tools")).body;
    expect(tools.find((t: any) => t.name === "mcp__laboratorio__dados_rolar")).toMatchObject({ source: "mcp", server: "laboratorio" });
  });

  it("desconecta e reconecta", async () => {
    expect((await ctx.api("POST", `/api/mcp/${labId}/disconnect`)).body.state.status).toBe("disconnected");
    expect((await ctx.api("POST", `/api/mcp/${labId}/connect`)).body.state.status).toBe("connected");
  });
});

describe("MCP: validação do cadastro", () => {
  it("não aceita mais o transporte stdio (não há servidor local)", async () => {
    const res = await ctx.api("POST", "/api/mcp", { name: "processo", transport: "stdio", command: "node", args: ["servidor.js"] });
    expect(res.status).toBe(400);
  });

  it("rejeita nomes duplicados e inválidos", async () => {
    expect((await ctx.api("POST", "/api/mcp", { name: "laboratorio", transport: "builtin", command: "laboratorio" })).status).toBe(409);
    expect((await ctx.api("POST", "/api/mcp", { name: "nome com espaço", transport: "http", url: "https://x" })).status).toBe(400);
  });
});

describe("MCP: edição e diagnóstico de conexão", () => {
  it("editar mantém valores ocultos e renomear atualiza as ferramentas dos agentes", async () => {
    const created = await ctx.api("POST", "/api/mcp", {
      name: "remoto_teste",
      transport: "http",
      url: "https://exemplo.dev/mcp",
      headers: { Authorization: "Bearer re_secreta" },
      enabled: false,
    });
    expect(created.body.headers).toEqual({ Authorization: "••••" });
    const agent = await ctx.api("POST", "/api/agents", {
      name: "Usa remoto",
      llmId: "llm_demo",
      systemPrompt: "x",
      tools: ["mcp__remoto_teste__*", "calculator"],
      maxIterations: 3,
      requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
    });

    const updated = await ctx.api("PUT", `/api/mcp/${created.body.id}`, {
      name: "resend",
      transport: "http",
      url: "https://mcp.resend.com/mcp",
      headers: { Authorization: "••••", "X-Extra": "1" },
      enabled: false,
    });
    expect(updated.status).toBe(200);
    const stored = ctx.db.mcpServers.find((s) => s.id === created.body.id)!;
    expect(stored.headers).toEqual({ Authorization: "Bearer re_secreta", "X-Extra": "1" });
    expect(stored.url).toBe("https://mcp.resend.com/mcp");
    expect(ctx.db.agents.find((a) => a.id === agent.body.id)!.tools).toEqual(["mcp__resend__*", "calculator"]);
  });

  it("explica bloqueio de CORS e cabeçalho de autenticação sem o tipo", async () => {
    const { explainConnectError } = await import("../mcp/manager.js");
    const cors = explainConnectError("SSE error: Failed to fetch", { transport: "http", headers: {} });
    expect(cors).toMatch(/CORS/);
    expect(cors).toMatch(/API da Anthropic/);
    expect(explainConnectError("HTTP 401 Unauthorized", { transport: "http", headers: { Authorization: "re_123" } })).toMatch(
      /Bearer <chave>/,
    );
    expect(explainConnectError("timeout", { transport: "http", headers: { Authorization: "Bearer re_123" } })).toBe("timeout");
  });
});

describe("MCP: exclusão", () => {
  it("apagar um servidor remove as ferramentas dele dos agentes", async () => {
    const created = await ctx.api("POST", "/api/mcp", {
      name: "para_apagar",
      transport: "http",
      url: "https://exemplo.dev/mcp",
      enabled: false,
    });
    const agent = await ctx.api("POST", "/api/agents", {
      name: "Usa apagado",
      llmId: "llm_demo",
      systemPrompt: "x",
      tools: ["mcp__para_apagar__*", "mcp__para_apagar__enviar", "calculator"],
      maxIterations: 3,
      requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
    });
    await ctx.api("DELETE", `/api/mcp/${created.body.id}`);
    expect(ctx.db.agents.find((a) => a.id === agent.body.id)!.tools).toEqual(["calculator"]);
  });
});
