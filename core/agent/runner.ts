import type Anthropic from "@anthropic-ai/sdk";
import { audit } from "../audit.js";
import { callLlm, friendlyLlmError, llmHasCredentials } from "../llm/index.js";
import { createMemory, searchMemories } from "../memory.js";
import { allMcpTools, callMcpTool, resolveMcpTool } from "../mcp/manager.js";
import { rememberUsedTool, remoteMcpFor } from "../mcp/remote.js";
import { db, persist } from "../store.js";
import { builtinTools, type ToolContext } from "../tools/builtin.js";
import { contextWindowFor } from "../llm/catalog.js";
import {
  compactedMessage,
  contextBreakdown,
  historyShare,
  estimateTokens,
  extractSummary,
  shouldCompact,
  SUMMARY_PROMPT,
} from "./context.js";
import { agentIdFromTool, agentToolDefinition, delegationBlocked, isAgentTool } from "./delegation.js";
import { collectCitations, isServerTool, serverToolDefinitions } from "../tools/server.js";
import type { AssistantTurn } from "../llm/types.js";
import { toolUsesOf, turnOutcome, turnText } from "./turn.js";
import type { AgentConfig, LlmConfig, RunEvent, RunRecord } from "../types.js";
import { bus, clip, errorMessage, isRecord, now, uid } from "../util.js";

/**
 * O CORAÇÃO DA PLATAFORMA: o loop agêntico.
 *
 *   1. monta o contexto (prompt de sistema + memórias recuperadas + histórico)
 *   2. chama o LLM com a lista de ferramentas disponíveis
 *   3. se o LLM pediu ferramentas → executa, devolve os resultados e volta ao passo 2
 *   4. se o LLM terminou (end_turn) → entrega a resposta final
 *
 * Cada passo emite um evento (para a visualização ao vivo) e um registro de auditoria.
 */

type LiveRun = {
  record: RunRecord;
  agent: AgentConfig;
  llm: LlmConfig;
  abort: AbortController;
  approvals: Map<string, (approved: boolean) => void>;
  busy: boolean;
  /** Resolve quando o loop atual termina (usado pela delegação para aguardar a filha). */
  finished?: Promise<void>;
};

const live = new Map<string, LiveRun>();

export function getLiveRun(id: string) {
  return live.get(id);
}

function emit(run: LiveRun, ev: RunEvent) {
  const events = run.record.events;
  const last = events[events.length - 1];
  // Deltas de texto/pensamento são agrupados no histórico salvo (mas transmitidos um a um ao vivo).
  if (
    last &&
    (ev.type === "text.delta" || ev.type === "thinking.delta") &&
    (last.type === "text.delta" || last.type === "thinking.delta") &&
    last.type === ev.type
  ) {
    last.text += ev.text;
  } else {
    events.push({ ...ev, ts: now(), seq: events.length });
  }
  bus.emit(`run:${run.record.id}`, { ...ev, ts: now() });
  if (ev.type !== "text.delta" && ev.type !== "thinking.delta") persist();
}

/** Ferramentas habilitadas para o agente, no formato da API, com seus executores. */
const toolEnabled = (agent: AgentConfig, name: string, server?: string) =>
  agent.tools.includes(name) || (server !== undefined && agent.tools.includes(`mcp__${server}__*`));

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

function buildSystemPrompt(agent: AgentConfig, recalled: { content: string; kind: string }[]): string {
  const parts = [agent.systemPrompt.trim()];
  if (recalled.length) {
    parts.push(
      "## Memórias relevantes (recuperadas automaticamente da memória de longo prazo)\n" +
        recalled.map((m) => `- [${m.kind}] ${m.content}`).join("\n"),
    );
  }
  parts.push(
    "## Ambiente\nVocê roda dentro do Agent Lab, uma plataforma de estudo de agentes autônomos. " +
      "Cada ação sua é registrada e visualizada. Seja transparente: antes de chamar ferramentas, diga em uma frase o que vai fazer.",
  );
  return parts.join("\n\n");
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

async function executeTool(
  run: LiveRun,
  block: { id: string; name: string; input: unknown },
  ctx: ToolContext,
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
      const r = await delegate(run, block.id, agentIdFromTool(block.name), typeof input.task === "string" ? input.task.trim() : "");
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

/** Executa uma subtarefa em outro agente e aguarda a resposta final (execução filha). */
async function delegate(parent: LiveRun, toolUseId: string, agentId: string, task: string): Promise<{ output: string; isError: boolean }> {
  const target = db.agents.find((a) => a.id === agentId);
  const depth = parent.record.depth ?? 0;
  const chain = parent.record.chain ?? [parent.agent.id];
  if (!target) throw new Error("O agente indicado não existe mais.");
  const blocked = delegationBlocked(chain, depth, target);
  if (blocked) throw new Error(blocked);
  if (!task) throw new Error("Informe a subtarefa no campo task.");

  const child = startRun(target, task, {
    parentRunId: parent.record.id,
    parentToolUseId: toolUseId,
    depth: depth + 1,
    chain: [...chain, target.id],
  });
  (parent.record.childRunIds ??= []).push(child.id);
  const names = [...chain, target.id].map((id) => db.agents.find((a) => a.id === id)?.name ?? id);
  emit(parent, { type: "delegation.started", toolUseId, childRunId: child.id, agentId: target.id, agentName: target.name, task });
  audit({
    type: "agent.delegated",
    actor: "agent",
    agentId: parent.agent.id,
    runId: parent.record.id,
    summary: `${names.join(" → ")}: ${clip(task, 100)}`,
    data: { chain: names, depth: depth + 1, childRunId: child.id, toolUseId },
  });

  // Cancelar a execução pai cancela a filha.
  const onAbort = () => cancelRun(child.id);
  parent.abort.signal.addEventListener("abort", onAbort, { once: true });
  await live.get(child.id)?.finished;
  parent.abort.signal.removeEventListener("abort", onAbort);

  const childUsage = {
    input: child.usage.input + (child.childUsage?.input ?? 0),
    output: child.usage.output + (child.childUsage?.output ?? 0),
  };
  const agg = (parent.record.childUsage ??= { input: 0, output: 0 });
  agg.input += childUsage.input;
  agg.output += childUsage.output;
  emit(parent, {
    type: "delegation.finished",
    toolUseId,
    childRunId: child.id,
    status: child.status,
    iterations: child.iterations,
    usage: childUsage,
  });
  audit({
    type: "agent.delegation_finished",
    actor: "agent",
    agentId: target.id,
    runId: parent.record.id,
    summary: `${target.name} ${child.status === "completed" ? "concluiu" : "não concluiu"} a subtarefa em ${child.iterations} iterações`,
    tokens: childUsage,
    data: { childRunId: child.id, status: child.status },
  });

  if (child.status === "completed") return { output: child.output || "(o agente não retornou texto)", isError: false };
  if (child.status === "cancelled") return { output: "A execução delegada foi cancelada.", isError: true };
  return { output: `O agente "${target.name}" falhou: ${child.error ?? "erro desconhecido"}`, isError: true };
}

/** Ferramentas de uma execução: as locais (executadas pelo loop) e as do provedor (executadas pela Anthropic). */
type RunTools = {
  local: Anthropic.Tool[];
  /** Ferramentas de servidor e conjuntos de ferramentas dos servidores MCP conectados pela API. */
  provider: Anthropic.Beta.BetaToolUnion[];
  mcpServers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[];
  /** Nomes para a auditoria, incluindo os curingas dos servidores MCP remotos. */
  names: string[];
  /** Habilitadas no agente, mas fora desta chamada porque a LLM não é da Anthropic. */
  ignored: { serverTools: string[]; remoteMcp: string[] };
};

function prepareTools({ agent, llm }: LiveRun): RunTools {
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
function providerEventForwarder(run: LiveRun): (ev: RunEvent) => void {
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

/**
 * Substitui o histórico por um resumo gerado pelo próprio modelo (compactação simples).
 * Só roda no início de uma iteração, com a rodada de ferramentas anterior já respondida.
 */
async function compactHistory(run: LiveRun, tools: RunTools, iteration: number, window: number) {
  const { record, llm, agent } = run;
  const messages = record.messages;
  const tokensBefore = record.context?.tokens ?? 0;
  const thresholdPct = agent.context?.thresholdPct ?? 60;
  const last = messages[messages.length - 1];
  // Ao continuar uma conversa, a nova mensagem do usuário fica fora do resumo e segue logo depois dele.
  const keepLast = typeof last?.content === "string" && messages.length > 1;
  const toSummarize = keepLast ? messages.slice(0, -1) : messages;

  const turn = await callLlm({
    llm,
    input: record.input,
    system: record.systemPrompt,
    messages: [...toSummarize, { role: "user", content: SUMMARY_PROMPT }],
    // As mesmas ferramentas da conversa: trocar a lista invalidaria o raciocínio já registrado.
    tools: tools.local,
    serverTools: tools.provider,
    mcpServers: tools.mcpServers,
    signal: run.abort.signal,
    emit: () => undefined,
  });
  record.usage.input += turn.usage.input;
  record.usage.output += turn.usage.output;
  const summary = extractSummary(turnText(turn.content));
  if (!summary) {
    audit({
      type: "context.compacted",
      actor: "system",
      agentId: agent.id,
      runId: record.id,
      summary: "Resumo do contexto não gerado: o modelo não retornou texto. O histórico foi mantido.",
    });
    return;
  }

  const messagesBefore = messages.length;
  record.messages = [{ role: "user", content: compactedMessage(record.input, summary) }, ...(keepLast ? [last] : [])];
  const tokensAfter = estimateTokens(record.systemPrompt) + estimateTokens(tools.local) + estimateTokens(record.messages);
  record.context = { tokens: tokensAfter, window };
  (record.compactions ??= []).push({ iteration, tokensBefore, messagesBefore, at: now() });
  emit(run, { type: "context.compacted", iteration, tokensBefore, tokensAfter, messagesBefore, summary, thresholdPct });
  audit({
    type: "context.compacted",
    actor: "system",
    agentId: agent.id,
    runId: record.id,
    summary: `Histórico resumido: ${messagesBefore} mensagens (${tokensBefore} tokens, ${Math.round((tokensBefore / window) * 100)}% da janela) → resumo de ~${tokensAfter} tokens`,
    tokens: turn.usage,
    data: { thresholdPct, window, tokensBefore, tokensAfter, messagesBefore, summary: clip(summary, 2000) },
  });
}

async function compactIfNeeded(run: LiveRun, tools: RunTools, iteration: number) {
  const { record, agent, llm } = run;
  if (!record.context) return;
  const window = contextWindowFor(llm);
  const lastCompaction = record.compactions?.at(-1);
  const due = shouldCompact({
    enabled: agent.context?.autoCompact ?? false,
    thresholdPct: agent.context?.thresholdPct ?? 60,
    tokens: record.context.tokens,
    window,
    messageCount: record.messages.length,
    historyShare: historyShare(record.systemPrompt, [...tools.local, ...tools.provider], record.messages),
    lastMessageFromUser: record.messages.at(-1)?.role === "user",
    iterationsSinceCompaction: lastCompaction ? iteration - lastCompaction.iteration : null,
  });
  if (due) await compactHistory(run, tools, iteration, window);
}

function announceRequest(run: LiveRun, tools: RunTools, iteration: number) {
  const { agent, record, llm } = run;
  record.iterations = iteration;
  emit(run, { type: "iteration.started", iteration });
  emit(run, {
    type: "llm.request",
    iteration,
    messageCount: record.messages.length,
    toolCount: tools.names.length,
    systemPrompt: record.systemPrompt,
  });
  audit({
    type: "llm.request",
    actor: "agent",
    agentId: agent.id,
    runId: record.id,
    summary: `Iteração ${iteration}: ${record.messages.length} mensagens, ${tools.names.length} ferramentas → ${llm.name} (${llm.model})`,
    data: {
      llm: llm.name,
      provider: llm.provider,
      model: llm.model,
      effort: llm.provider === "anthropic" ? llm.effort : undefined,
      tools: tools.names,
      ...(tools.ignored.serverTools.length
        ? { serverToolsIgnored: tools.ignored.serverTools, reason: "ferramentas de servidor exigem uma LLM Anthropic" }
        : {}),
      ...(tools.ignored.remoteMcp.length
        ? {
            remoteMcpIgnored: tools.ignored.remoteMcp,
            remoteMcpReason: "servidores MCP conectados pela Anthropic exigem uma LLM Anthropic",
          }
        : {}),
    },
  });
}

/** Registra a resposta: consumo, medição da janela, citações e o turno no histórico. */
function recordResponse(run: LiveRun, tools: RunTools, iteration: number, turn: AssistantTurn, durationMs: number) {
  const { agent, record, llm } = run;
  record.usage.input += turn.usage.input;
  record.usage.output += turn.usage.output;
  emit(run, { type: "llm.response", iteration, stopReason: turn.stopReason, usage: turn.usage, durationMs, model: turn.model });

  // Medição da janela: tokens reais de entrada (com cache) e detalhamento estimado.
  const window = contextWindowFor(llm);
  const contextTokens = turn.usage.input + (turn.usage.cacheRead ?? 0) + (turn.usage.cacheWrite ?? 0);
  record.context = { tokens: contextTokens, window };
  emit(run, {
    type: "context.measured",
    iteration,
    tokens: contextTokens,
    window,
    cacheRead: turn.usage.cacheRead ?? 0,
    breakdown: contextBreakdown(record.systemPrompt, [...tools.local, ...tools.provider], record.messages),
    messageCount: record.messages.length,
  });

  const toolUses = toolUsesOf(turn.content);
  audit({
    type: "llm.response",
    actor: "agent",
    agentId: agent.id,
    runId: record.id,
    summary: `Resposta (${turn.stopReason}) — ${toolUses.length} chamadas de ferramenta`,
    durationMs,
    tokens: turn.usage,
    data: {
      model: turn.model,
      stopReason: turn.stopReason,
      text: clip(turnText(turn.content), 2000),
      toolUses: toolUses.map((t) => t.name),
    },
  });
  const citations = collectCitations(turn.content);
  if (citations.length) emit(run, { type: "citations", items: citations });

  // O conteúdo do assistente volta para o histórico exatamente como veio (inclusive blocos de pensamento).
  record.messages.push({ role: "assistant", content: turn.content });
}

/** Itera até o modelo entregar a resposta final e a devolve. */
async function iterate(run: LiveRun, tools: RunTools): Promise<string> {
  const { agent, record, llm } = run;
  const ctx: ToolContext = {
    agentId: agent.id,
    runId: record.id,
    scratchpad: record.scratchpad,
    onMemoryCreated: (memory) => emit(run, { type: "memory.created", memory }),
  };
  const forward = providerEventForwarder(run);
  let carried = "";
  const startIteration = record.iterations;
  for (let i = 1; ; i++) {
    if (i > agent.maxIterations) throw new Error(`Limite de ${agent.maxIterations} iterações atingido sem concluir a tarefa.`);
    if (run.abort.signal.aborted) throw new DOMException("cancelado", "AbortError");
    const iteration = startIteration + i;
    await compactIfNeeded(run, tools, iteration);
    announceRequest(run, tools, iteration);

    const started = Date.now();
    const turn = await callLlm({
      llm,
      input: record.input,
      system: record.systemPrompt,
      messages: record.messages,
      tools: tools.local,
      serverTools: tools.provider,
      mcpServers: tools.mcpServers,
      signal: run.abort.signal,
      emit: forward,
    });
    recordResponse(run, tools, iteration, turn, Date.now() - started);

    const outcome = turnOutcome(turn, carried);
    switch (outcome.kind) {
      case "failed":
        throw new Error(outcome.error);
      case "resume":
        carried = outcome.carried;
        break;
      case "final":
        return outcome.text;
      case "tools": {
        // Executa as ferramentas em paralelo e devolve TODOS os resultados em uma única mensagem de usuário.
        const results = await Promise.all(outcome.toolUses.map((b) => executeTool(run, b, ctx)));
        record.messages.push({ role: "user", content: results });
        break;
      }
    }
  }
}

function completeRun(run: LiveRun, finalText: string) {
  const { agent, record } = run;
  record.status = "completed";
  record.output = finalText;
  record.finishedAt = now();
  emit(run, {
    type: "run.completed",
    output: finalText,
    iterations: record.iterations,
    usage: record.usage,
    ...(record.childUsage ? { childUsage: record.childUsage } : {}),
  });
  audit({
    type: "run.completed",
    actor: "agent",
    agentId: agent.id,
    runId: record.id,
    summary: `Execução concluída em ${record.iterations} iterações`,
    tokens: record.usage,
    durationMs: Date.now() - new Date(record.startedAt).getTime(),
    data: { output: clip(finalText, 2000) },
  });
  if (agent.memory.autoEpisode && finalText) {
    const memory = createMemory({
      content: summarizeEpisode(record.input, record.iterations, record.events, finalText),
      kind: "episode",
      tags: ["episódio", agent.name],
      importance: 2,
      agentId: agent.id,
      source: "auto",
      runId: record.id,
    });
    emit(run, { type: "memory.created", memory });
  }
}

function endRun(run: LiveRun, err: unknown) {
  const { agent, record } = run;
  record.finishedAt = now();
  if (run.abort.signal.aborted) {
    record.status = "cancelled";
    emit(run, { type: "run.cancelled" });
    audit({ type: "run.cancelled", actor: "user", agentId: agent.id, runId: record.id, summary: "Execução cancelada pelo usuário" });
    return;
  }
  const message = friendlyLlmError(err) ?? errorMessage(err);
  record.status = "failed";
  record.error = message;
  emit(run, { type: "run.failed", error: message });
  audit({ type: "run.failed", actor: "system", agentId: agent.id, runId: record.id, summary: `Falhou: ${message}` });
}

async function loop(run: LiveRun) {
  run.busy = true;
  run.record.status = "running";
  try {
    if (!llmHasCredentials(run.llm)) {
      throw new Error(
        `A LLM "${run.llm.name}" não tem chave de API. Abra “LLMs”, cole a chave e tente de novo — ` +
          "ou troque o agente para a LLM “Demo (offline)” para ver o loop funcionando sem chave.",
      );
    }
    completeRun(run, await iterate(run, prepareTools(run)));
  } catch (err) {
    endRun(run, err);
  } finally {
    run.busy = false;
    persist();
  }
}

function llmFor(agent: AgentConfig, overrideId?: string): LlmConfig {
  const id = overrideId ?? agent.llmId;
  const llm = db.llms.find((l) => l.id === id);
  if (!llm)
    throw new Error(
      overrideId
        ? "A LLM escolhida para esta execução não existe mais."
        : `O agente "${agent.name}" não tem uma LLM válida. Escolha uma no editor do agente.`,
    );
  return structuredClone(llm);
}

/**
 * Resumo episódico curto e autocontido: tarefa, ferramentas, iterações e a primeira frase da resposta.
 * Nunca inclui trechos de outras memórias (o que faria os episódios crescerem a cada execução).
 */
export function summarizeEpisode(input: string, iterations: number, events: RunRecord["events"], finalText: string): string {
  // Remove marcação de markdown apenas da resposta do modelo.
  const clean = (t: string) =>
    t
      .replace(/[*_`>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const tools = [...new Set(events.flatMap((e) => (e.type === "tool.call" ? [e.name.replace(/^mcp__(.+?)__/, "$1/")] : [])))];
  const firstLine = clean(finalText.split("\n").find((l) => l.trim() && !/epis[óo]dio/i.test(l)) ?? "");
  const firstSentence = firstLine.split(/(?<=[.!?:])\s/)[0] ?? "";
  const task = input.replace(/\s+/g, " ").trim(); // a tarefa é preservada como o usuário escreveu
  const parts = [
    `Tarefa "${task.length > 80 ? `${task.slice(0, 79)}…` : task}"`,
    `${iterations} ${iterations === 1 ? "iteração" : "iterações"}`,
    tools.length ? `ferramentas: ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""}` : "sem ferramentas",
  ];
  const result = firstSentence ? ` Resultado: ${firstSentence.length > 70 ? `${firstSentence.slice(0, 69)}…` : firstSentence}` : "";
  return `${parts.join(" · ")}.${result}`.slice(0, 220);
}

/**
 * Inicia uma execução. `llmId` troca a LLM só nesta execução (sem alterar o agente);
 * `comparisonId` agrupa execuções disparadas juntas pela comparação lado a lado.
 */
export type StartRunOptions = {
  llmId?: string | undefined;
  comparisonId?: string | undefined;
  parentRunId?: string | undefined;
  parentToolUseId?: string | undefined;
  depth?: number | undefined;
  chain?: string[] | undefined;
};

export function startRun(agent: AgentConfig, input: string, opts: StartRunOptions = {}): RunRecord {
  const llm = llmFor(agent, opts.llmId);
  // Episódios ficam fora do recall automático por padrão: são registros do passado, não conhecimento.
  const recalled = agent.memory.autoRecall
    ? searchMemories(input, {
        agentId: agent.id,
        limit: agent.memory.recallLimit,
        touch: true,
        excludeKinds: agent.memory.recallEpisodes ? [] : ["episode"],
      })
    : [];
  const record: RunRecord = {
    id: uid("run"),
    agentId: agent.id,
    agentName: agent.name,
    input,
    status: "running",
    output: null,
    error: null,
    iterations: 0,
    usage: { input: 0, output: 0 },
    startedAt: now(),
    finishedAt: null,
    events: [],
    messages: [{ role: "user", content: input }],
    systemPrompt: buildSystemPrompt(
      agent,
      recalled.map((r) => r.memory),
    ),
    scratchpad: [],
    llmId: llm.id,
    ...(opts.comparisonId ? { comparisonId: opts.comparisonId } : {}),
    ...(opts.parentRunId
      ? { parentRunId: opts.parentRunId, parentToolUseId: opts.parentToolUseId, depth: opts.depth ?? 1, chain: opts.chain }
      : {}),
  };
  db.runs.push(record);
  const run: LiveRun = { record, agent: structuredClone(agent), llm, abort: new AbortController(), approvals: new Map(), busy: false };
  live.set(record.id, run);

  emit(run, {
    type: "run.started",
    runId: record.id,
    agentId: agent.id,
    input,
    provider: llm.provider,
    model: llm.model,
    llmName: llm.name,
  });
  audit({
    type: "run.started",
    actor: opts.parentRunId ? "agent" : "user",
    agentId: agent.id,
    runId: record.id,
    summary: `${opts.parentRunId ? "Execução delegada" : "Nova execução"} de "${agent.name}": ${clip(input, 100)}`,
    data: {
      input,
      llm: llm.name,
      provider: llm.provider,
      model: llm.model,
      ...(opts.parentRunId ? { parentRunId: opts.parentRunId, depth: opts.depth } : {}),
    },
  });
  if (recalled.length) {
    emit(run, {
      type: "memory.recalled",
      memories: recalled.map((r) => ({ id: r.memory.id, content: r.memory.content, score: +r.score.toFixed(3), kind: r.memory.kind })),
    });
    audit({
      type: "memory.recalled",
      actor: "system",
      agentId: agent.id,
      runId: record.id,
      summary: `${recalled.length} memórias injetadas no contexto`,
      data: recalled.map((r) => ({ id: r.memory.id, score: r.score })),
    });
  }
  run.finished = loop(run);
  return record;
}

/** Continua a conversa de uma execução já concluída (memória de curto prazo = histórico). */
export function continueRun(id: string, text: string): RunRecord {
  const record = db.runs.find((r) => r.id === id);
  if (!record) throw new Error("Execução não encontrada.");
  let run = live.get(id);
  if (run?.busy) throw new Error("A execução ainda está em andamento.");
  const agent = db.agents.find((a) => a.id === record.agentId);
  if (!agent) throw new Error("Agente desta execução foi removido.");
  // A conversa continua com a configuração atual do agente. Execuções com LLM própria (comparações) a mantêm.
  const llm = llmFor(agent, record.comparisonId ? record.llmId : undefined);
  if (!run) {
    run = { record, agent: structuredClone(agent), llm, abort: new AbortController(), approvals: new Map(), busy: false };
    live.set(id, run);
  } else {
    run.agent = structuredClone(agent);
    run.llm = llm;
    run.abort = new AbortController();
  }
  record.messages.push({ role: "user", content: text });
  record.status = "running";
  record.error = null;
  record.finishedAt = null;
  emit(run, { type: "user.message", text });
  audit({ type: "run.started", actor: "user", agentId: agent.id, runId: id, summary: `Nova mensagem na execução: ${clip(text, 100)}` });
  run.finished = loop(run);
  return record;
}

export function cancelRun(id: string): boolean {
  const run = live.get(id);
  if (!run?.busy) return false;
  run.abort.abort();
  return true;
}

export function resolveApproval(id: string, toolUseId: string, approved: boolean): boolean {
  const resolve = live.get(id)?.approvals.get(toolUseId);
  if (!resolve) return false;
  resolve(approved);
  return true;
}
