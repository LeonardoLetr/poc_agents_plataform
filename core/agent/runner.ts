import { audit } from "../audit.js";
import { callLlm, friendlyLlmError, llmHasCredentials } from "../llm/index.js";
import { createMemory, searchMemories, summarizeEpisode } from "../memory.js";
import { db, persist } from "../store.js";
import { type ToolContext } from "../tools/builtin.js";
import { contextWindowFor } from "../llm/catalog.js";
import { contextBreakdown } from "./context.js";
import { delegationBlocked } from "./delegation.js";
import { collectCitations } from "../tools/server.js";
import type { AssistantTurn } from "../llm/types.js";
import { toolUsesOf, turnOutcome, turnText } from "./turn.js";
import type { AgentConfig, LlmConfig, RunRecord } from "../types.js";
import { clip, errorMessage, now, uid } from "../util.js";
import { type LiveRun, live, emit } from "./live.js";
import { type RunTools, prepareTools, providerEventForwarder, executeTool } from "./tools.js";
import { compactIfNeeded } from "./compaction.js";

/**
 * O loop agêntico: monta o contexto, chama o modelo com as ferramentas, executa as que ele pedir e repete até a
 * resposta final. Cada etapa emite um evento para a linha do tempo e um registro de auditoria.
 */

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
        const results = await Promise.all(
          outcome.toolUses.map((b) => executeTool(run, b, ctx, (toolUseId, agentId, task) => delegate(run, toolUseId, agentId, task))),
        );
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
