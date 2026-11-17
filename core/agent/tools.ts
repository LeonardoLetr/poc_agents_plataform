import type Anthropic from "@anthropic-ai/sdk";
import { audit } from "../audit.js";
import { allMcpTools, callMcpTool, resolveMcpTool } from "../mcp/manager.js";
import { rememberUsedTool, remoteMcpFor } from "../mcp/remote.js";
import { db, persist } from "../store.js";
import { builtinTools, type ToolContext } from "../tools/builtin.js";
import { agentIdFromTool, agentToolDefinition, isAgentTool } from "./delegation.js";
import { isServerTool, serverToolDefinitions } from "../tools/server.js";
import type { AgentConfig, LlmConfig, RunEvent } from "../types.js";
import { clip, errorMessage, isRecord } from "../util.js";
import { type LiveRun, emit } from "./live.js";

/** Ferramentas de uma execução: quais vão para o modelo, como as locais são executadas e como as do provedor são auditadas. */

/** Habilitada no agente pelo nome ou pelo curinga do servidor (`mcp__<servidor>__*`). */
const toolEnabled = (agent: AgentConfig, name: string, server?: string) =>
  agent.tools.includes(name) || (server !== undefined && agent.tools.includes(`mcp__${server}__*`));

/** Ferramentas locais do agente no formato da API: nativas, outros agentes e MCP conectado pela página. */
function resolveTools(agent: AgentConfig) {
  const defs: Anthropic.Tool[] = [];
  for (const name of agent.tools) {
    const b = builtinTools[name];
    if (b) defs.push(b.definition);
  }
  for (const name of agent.tools) {
    if (!isAgentTool(name)) continue;
    const target = db.agents.find((a) => a.id === agentIdFromTool(name));
    if (target && target.id !== agent.id) defs.push(agentToolDefinition(target));
  }
  const mcp = allMcpTools(db.mcpServers).filter((t) => toolEnabled(agent, t.definition.name, t.server.name));
  for (const t of mcp) defs.push(t.definition);
  return defs;
}

/** Ferramentas de servidor habilitadas no agente. Só são enviadas a LLMs Anthropic. */
function resolveServerTools(agent: AgentConfig, llm: LlmConfig): { defs: Anthropic.Beta.BetaToolUnion[]; ignored: string[] } {
  const names = agent.tools.filter(isServerTool);
  if (llm.provider !== "anthropic") return { defs: [], ignored: names };
  return { defs: serverToolDefinitions(names, llm.model), ignored: [] };
}

/** Ferramentas de uma execução: as locais (executadas pelo loop) e as do provedor (executadas pela Anthropic). */
export type RunTools = {
  local: Anthropic.Tool[];
  /** Ferramentas de servidor e conjuntos de ferramentas dos servidores MCP conectados pela API. */
  provider: Anthropic.Beta.BetaToolUnion[];
  mcpServers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[];
  /** Nomes para a auditoria, incluindo os curingas dos servidores MCP remotos. */
  names: string[];
  /** Habilitadas no agente, mas fora desta chamada porque a LLM não é da Anthropic. */
  ignored: { serverTools: string[]; remoteMcp: string[] };
};

export function prepareTools({ agent, llm }: LiveRun): RunTools {
  const local = resolveTools(agent);
  const server = resolveServerTools(agent, llm);
  const remote = remoteMcpFor(agent, llm, db.mcpServers);
  return {
    local,
    provider: [...server.defs, ...remote.toolsets],
    mcpServers: remote.servers,
    names: [
      ...local.map((t) => t.name),
      ...agent.tools.filter(isServerTool).filter(() => server.defs.length > 0),
      ...remote.servers.map((s) => `mcp__${s.name}__*`),
    ],
    ignored: { serverTools: server.ignored, remoteMcp: remote.ignored },
  };
}

/**
 * Repassa os eventos do provedor à execução. Chamadas que a Anthropic executa (ferramentas de servidor e MCP
 * pela API) não passam por executeTool, então são auditadas aqui.
 */
export function providerEventForwarder(run: LiveRun): (ev: RunEvent) => void {
  const { agent, record } = run;
  const remoteCalls = new Set<string>();
  const auditCall = (ev: Extract<RunEvent, { type: "tool.call" }>, via: string, extra: Record<string, unknown>) =>
    audit({
      type: "tool.call",
      actor: "agent",
      agentId: agent.id,
      runId: record.id,
      summary: `Chamou ${ev.name} (${via})`,
      data: { toolUseId: ev.id, input: ev.input, ...extra, executedBy: "anthropic" },
    });
  const auditResult = (ev: Extract<RunEvent, { type: "tool.result" }>, via: string) =>
    audit({
      type: "tool.result",
      actor: "system",
      agentId: agent.id,
      runId: record.id,
      summary: `${ev.name} ${ev.isError ? "falhou" : "respondeu"} em ${ev.durationMs}ms (${via})`,
      durationMs: ev.durationMs,
      data: { toolUseId: ev.id, output: clip(ev.output, 2000), isError: ev.isError },
    });

  return (ev) => {
    emit(run, ev);
    if (ev.type === "tool.call" && ev.source === "mcp") {
      remoteCalls.add(ev.id);
      // A ferramenta usada fica registrada no servidor: a lista na tela cresce com o uso, sem custo.
      const remoteServer = db.mcpServers.find((s) => s.name === ev.server);
      if (remoteServer && ev.server && rememberUsedTool(remoteServer, ev.name.slice(`mcp__${ev.server}__`.length))) persist();
      auditCall(ev, "MCP via Anthropic", { server: ev.server });
    } else if (ev.type === "tool.result" && remoteCalls.has(ev.id)) auditResult(ev, "MCP via Anthropic");
    else if (ev.type === "tool.call" && ev.source === "server") auditCall(ev, "servidor Anthropic", {});
    else if (ev.type === "tool.result" && isServerTool(ev.name)) auditResult(ev, "servidor Anthropic");
  };
}

/** Pede aprovação ao usuário e aguarda a decisão; cancelar a execução conta como negar. */
async function requestApproval(run: LiveRun, toolUseId: string, name: string, input: unknown): Promise<boolean> {
  run.record.status = "awaiting_approval";
  // O receptor da decisão é registrado ANTES de anunciar o pedido: uma resposta imediata não pode se perder.
  const decision = new Promise<boolean>((resolve) => {
    run.approvals.set(toolUseId, resolve);
    run.abort.signal.addEventListener("abort", () => resolve(false), { once: true });
  });
  emit(run, { type: "tool.approval_requested", id: toolUseId, name, input });
  audit({
    type: "tool.approval_requested",
    actor: "system",
    agentId: run.agent.id,
    runId: run.record.id,
    summary: `Aguardando aprovação para ${name}`,
  });
  const approved = await decision;
  run.approvals.delete(toolUseId);
  if (run.approvals.size === 0) run.record.status = "running";
  emit(run, { type: "tool.approval_resolved", id: toolUseId, approved });
  audit({
    type: "tool.approval_resolved",
    actor: "user",
    agentId: run.agent.id,
    runId: run.record.id,
    summary: `${approved ? "Aprovou" : "Negou"} ${name}`,
  });
  return approved;
}

/** Executa a subtarefa de uma ferramenta agent__ em outro agente (vem do runner, que inicia execuções). */
export type Delegate = (toolUseId: string, agentId: string, task: string) => Promise<{ output: string; isError: boolean }>;

export async function executeTool(
  run: LiveRun,
  block: { id: string; name: string; input: unknown },
  ctx: ToolContext,
  delegate: Delegate,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const input = isRecord(block.input) ? block.input : {};
  const delegated = isAgentTool(block.name);
  const mcp = builtinTools[block.name] || delegated ? null : resolveMcpTool(block.name, db.mcpServers);
  emit(run, {
    type: "tool.call",
    id: block.id,
    name: block.name,
    input,
    source: delegated ? "agent" : mcp ? "mcp" : "builtin",
    server: mcp?.server.name,
  });
  audit({
    type: "tool.call",
    actor: "agent",
    agentId: run.agent.id,
    runId: run.record.id,
    summary: `Chamou ${block.name}`,
    data: { toolUseId: block.id, input, server: mcp?.server.name },
  });

  if (run.agent.requireApproval && !(await requestApproval(run, block.id, block.name, input))) {
    const output = "O usuário NEGOU a execução desta ferramenta. Siga sem ela ou pergunte como prosseguir.";
    emit(run, { type: "tool.result", id: block.id, name: block.name, output, isError: true, durationMs: 0 });
    return { type: "tool_result", tool_use_id: block.id, content: output, is_error: true };
  }

  const started = Date.now();
  let output: string;
  let isError = false;
  try {
    if (!toolEnabled(run.agent, block.name, mcp?.server.name))
      throw new Error(`Ferramenta "${block.name}" não está habilitada para este agente.`);
    const builtin = builtinTools[block.name];
    if (builtin) output = await builtin.run(input, ctx);
    else if (delegated) {
      const r = await delegate(block.id, agentIdFromTool(block.name), typeof input.task === "string" ? input.task.trim() : "");
      output = r.output;
      isError = r.isError;
    } else if (mcp) {
      const r = await callMcpTool(mcp.server.id, mcp.tool.name, input);
      output = r.text;
      isError = r.isError;
    } else throw new Error(`Ferramenta desconhecida: ${block.name}`);
  } catch (err) {
    output = `Erro: ${errorMessage(err)}`;
    isError = true;
  }
  const durationMs = Date.now() - started;
  output = clip(output, 12_000);
  emit(run, { type: "tool.result", id: block.id, name: block.name, output, isError, durationMs });
  audit({
    type: "tool.result",
    actor: "system",
    agentId: run.agent.id,
    runId: run.record.id,
    summary: `${block.name} ${isError ? "falhou" : "respondeu"} em ${durationMs}ms`,
    durationMs,
    data: { toolUseId: block.id, output: clip(output, 2000), isError },
  });
  return { type: "tool_result", tool_use_id: block.id, content: output, ...(isError ? { is_error: true } : {}) };
}
