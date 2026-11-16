import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizationToken, mergeKnownTools, parseDiscoveredTools, remoteMcpFor } from "../mcp/remote.js";
import type { AgentConfig, LlmConfig, McpServerConfig } from "../types.js";
import { bootCore, collectRun, waitFor } from "./helpers.js";

const server = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "mcp_r", name: "resend", transport: "http", url: "https://mcp.resend.com/mcp", headers: { Authorization: "Bearer re_123" }, via: "anthropic", enabled: true, createdAt: "", ...over,
});
const agent = (tools: string[]) => ({ tools }) as AgentConfig;
const llm = (provider: LlmConfig["provider"]) => ({ provider }) as LlmConfig;

afterEach(() => vi.unstubAllGlobals());

describe("MCP conectado pela Anthropic: montagem da requisição", () => {
  it("extrai o token do cabeçalho Authorization com ou sem Bearer", () => {
    expect(authorizationToken({ Authorization: "Bearer re_123" })).toBe("re_123");
    expect(authorizationToken({ authorization: "re_456" })).toBe("re_456");
    expect(authorizationToken({})).toBeUndefined();
  });

  it("envia servidor e conjunto de ferramentas só para LLMs Anthropic", () => {
    const all = remoteMcpFor(agent(["mcp__resend__*"]), llm("anthropic"), [server()]);
    expect(all.servers).toEqual([{ type: "url", name: "resend", url: "https://mcp.resend.com/mcp", authorization_token: "re_123" }]);
    expect(all.toolsets).toEqual([{ type: "mcp_toolset", mcp_server_name: "resend" }]);

    const only = remoteMcpFor(agent(["mcp__resend__send_email"]), llm("anthropic"), [server()]);
    expect(only.toolsets[0]).toEqual({ type: "mcp_toolset", mcp_server_name: "resend", default_config: { enabled: false }, configs: { send_email: { enabled: true } } });

    const other = remoteMcpFor(agent(["mcp__resend__*"]), llm("openai"), [server()]);
    expect(other).toEqual({ servers: [], toolsets: [], ignored: ["resend"] });
    expect(remoteMcpFor(agent(["mcp__resend__*"]), llm("anthropic"), [server({ via: "client" })]).servers).toEqual([]);
    expect(remoteMcpFor(agent(["mcp__resend__*"]), llm("anthropic"), [server({ enabled: false })]).servers).toEqual([]);
  });
});

describe("MCP conectado pela Anthropic: execução", () => {
  const sse = (events: Record<string, unknown>[]) =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  const start = { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 80, output_tokens: 1 } } };
  const end = [{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" }];

  it("não abre conexão local, envia o servidor na requisição e mostra chamada e resultado", async () => {
    const { core, api, db } = await bootCore();
    const requests: { url: string; headers: Record<string, string>; body: { mcp_servers?: unknown[]; tools: { type?: string; name?: string; mcp_server_name?: string }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body as string) });
      return sse([
        start,
        { type: "content_block_start", index: 0, content_block: { type: "mcp_tool_use", id: "mcptoolu_1", name: "send_email", server_name: "resend", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"to":"ana@exemplo.com","subject":"Oi"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "mcp_tool_result", tool_use_id: "mcptoolu_1", is_error: false, content: [{ type: "text", text: "Email sent: 4f2a" }] } },
        { type: "content_block_stop", index: 1 },
        { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "E-mail enviado." } },
        { type: "content_block_stop", index: 2 },
        ...end,
      ]);
    }));

    const created = await api("POST", "/api/mcp", { name: "resend", transport: "http", url: "https://mcp.resend.com/mcp", headers: { Authorization: "Bearer re_teste" }, via: "anthropic" });
    await waitFor(() => db.mcpServers.length > 0);
    expect(created.body.state.status).toBe("connected");
    expect(requests).toHaveLength(0); // nenhuma conexão saiu do Agent Lab

    const tools = await api<{ name: string; viaAnthropic?: boolean }[]>("GET", "/api/tools");
    expect(tools.body.find((t) => t.name === "mcp__resend__*")?.viaAnthropic).toBe(true);

    const llmRes = await api("POST", "/api/llms", { name: "Opus MCP", provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-teste-mcp", effort: "medium", refusalFallback: false });
    const agentRes = await api("POST", "/api/agents", {
      name: "Mensageiro", llmId: llmRes.body.id, systemPrompt: "Envie e-mails.", tools: ["mcp__resend__*"], maxIterations: 3, requireApproval: false,
      memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
    });
    const run = await api("POST", "/api/runs", { agentId: agentRes.body.id, input: "mande um oi para ana@exemplo.com" });
    const events = await collectRun(core, run.body.id);

    expect(events.some((e) => e.type === "run.completed")).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("api.anthropic.com");
    expect(requests[0].headers["anthropic-beta"]).toContain("mcp-client-2025-11-20");
    expect(requests[0].body.mcp_servers).toEqual([{ type: "url", name: "resend", url: "https://mcp.resend.com/mcp", authorization_token: "re_teste" }]);
    expect(requests[0].body.tools).toContainEqual({ type: "mcp_toolset", mcp_server_name: "resend" });

    expect(events.find((e) => e.type === "tool.call")).toMatchObject({ id: "mcptoolu_1", name: "mcp__resend__send_email", source: "mcp", server: "resend", input: { to: "ana@exemplo.com", subject: "Oi" } });
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ id: "mcptoolu_1", output: "Email sent: 4f2a", isError: false });
    const audits = db.audit.filter((a) => a.runId === run.body.id).map((a) => a.summary);
    expect(audits.some((s) => s.includes("MCP via Anthropic"))).toBe(true);
    // A ferramenta usada fica registrada no servidor.
    expect(db.mcpServers.find((s) => s.name === "resend")!.knownTools).toEqual([{ name: "send_email", source: "used" }]);
  });
});

describe("MCP conectado pela Anthropic: descoberta de ferramentas", () => {
  const sse = (events: Record<string, unknown>[]) =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

  it("lê a lista do modelo e junta com as ferramentas já usadas", () => {
    expect(parseDiscoveredTools('<tools>[{"name":"gmail_send_email","description":"Envia"},{"name":"bad name"},"gmail_find_email"]</tools>')).toEqual([
      { name: "gmail_send_email", description: "Envia" },
      { name: "gmail_find_email" },
    ]);
    expect(parseDiscoveredTools("sem lista")).toEqual([]);
    expect(mergeKnownTools([{ name: "a", source: "used" }, { name: "old", source: "used" }], [{ name: "a" }, { name: "b" }])).toEqual([
      { name: "a", source: "used" },
      { name: "b", source: "discovered" },
      { name: "old", source: "used" },
    ]);
  });

  it("pede a lista ao Claude com o servidor anexado e a expõe para os agentes", async () => {
    const { api, db } = await bootCore();
    const bodies: { mcp_servers?: unknown[]; tools?: unknown[]; output_config?: { effort?: string } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      const text = '<tools>[{"name":"gmail_send_email","description":"Envia um e-mail pelo Gmail"},{"name":"gmail_create_draft","description":"Cria um rascunho"}]</tools>';
      return sse([
        { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 60 } },
        { type: "message_stop" },
      ]);
    }));
    await api("PUT", "/api/llms/llm_claude_opus", { ...db.llms.find((l) => l.id === "llm_claude_opus")!, apiKey: "sk-ant-teste-descoberta" });
    const created = await api("POST", "/api/mcp", { name: "zapier", transport: "http", url: "https://mcp.zapier.com/api/v1/connect", headers: { Authorization: "Bearer tok" }, via: "anthropic" });

    const res = await api("POST", `/api/mcp/${created.body.id}/discover`, {});
    expect(res.status).toBe(200);
    expect(bodies[0].mcp_servers).toEqual([{ type: "url", name: "zapier", url: "https://mcp.zapier.com/api/v1/connect", authorization_token: "tok" }]);
    expect(bodies[0].tools).toContainEqual({ type: "mcp_toolset", mcp_server_name: "zapier" });
    expect(bodies[0].output_config?.effort).toBe("low");
    expect(res.body.knownTools.map((t: { name: string }) => t.name)).toEqual(["gmail_send_email", "gmail_create_draft"]);

    const tools = await api<{ name: string }[]>("GET", "/api/tools");
    expect(tools.body.map((t) => t.name)).toEqual(expect.arrayContaining(["mcp__zapier__*", "mcp__zapier__gmail_send_email", "mcp__zapier__gmail_create_draft"]));
  });

  it("explica quando não há LLM Anthropic com chave", async () => {
    const { api, db } = await bootCore();
    // O núcleo é compartilhado entre os testes do arquivo: remove as chaves cadastradas antes.
    for (const l of db.llms.filter((x) => x.provider === "anthropic")) await api("PUT", `/api/llms/${l.id}`, { ...l, apiKey: "" });
    const created = await api("POST", "/api/mcp", { name: "sem_chave", transport: "http", url: "https://exemplo.dev/mcp", via: "anthropic" });
    const res = await api("POST", `/api/mcp/${created.body.id}/discover`, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/LLM Anthropic com chave/);
  });
});
