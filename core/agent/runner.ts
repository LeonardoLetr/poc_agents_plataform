import type Anthropic from "@anthropic-ai/sdk";
import { audit } from "../audit.js";
import { callLlm, friendlyLlmError, llmHasCredentials, type Msg } from "../llm/index.js";
import { createMemory, searchMemories } from "../memory.js";
import { allMcpTools, callMcpTool, resolveMcpTool } from "../mcp/manager.js";
import { db, persist } from "../store.js";
import { builtinTools, type ToolContext } from "../tools/builtin.js";
import type { AgentConfig, LlmConfig, RunEvent, RunRecord } from "../types.js";
import { bus, clip, errorMessage, now, uid } from "../util.js";

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

interface LiveRun {
  record: RunRecord;
  agent: AgentConfig;
  llm: LlmConfig;
  abort: AbortController;
  approvals: Map<string, (approved: boolean) => void>;
  busy: boolean;
}

const live = new Map<string, LiveRun>();

export function getLiveRun(id: string) {
  return live.get(id);
}

function emit(run: LiveRun, ev: RunEvent) {
  const events = run.record.events;
  const last = events[events.length - 1];
  // Deltas de texto/pensamento são agrupados no histórico salvo (mas transmitidos um a um ao vivo).
  if (last && (ev.type === "text.delta" || ev.type === "thinking.delta") && last.type === ev.type) {
    (last as { text: string }).text += ev.text;
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
  const mcp = allMcpTools(db.mcpServers).filter((t) => toolEnabled(agent, t.definition.name, t.server.name));
  for (const t of mcp) defs.push(t.definition);
  return defs;
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

async function executeTool(run: LiveRun, block: { id: string; name: string; input: unknown }, ctx: ToolContext): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const mcp = builtinTools[block.name] ? null : resolveMcpTool(block.name, db.mcpServers);
  emit(run, { type: "tool.call", id: block.id, name: block.name, input, source: mcp ? "mcp" : "builtin", server: mcp?.server.name });
  audit({
    type: "tool.call",
    actor: "agent",
    agentId: run.agent.id,
    runId: run.record.id,
    summary: `Chamou ${block.name}`,
    data: { toolUseId: block.id, input, server: mcp?.server.name },
  });

  if (run.agent.requireApproval) {
    run.record.status = "awaiting_approval";
    emit(run, { type: "tool.approval_requested", id: block.id, name: block.name, input });
    audit({ type: "tool.approval_requested", actor: "system", agentId: run.agent.id, runId: run.record.id, summary: `Aguardando aprovação para ${block.name}` });
    const approved = await new Promise<boolean>((resolve) => {
      run.approvals.set(block.id, resolve);
      run.abort.signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    run.approvals.delete(block.id);
    if (run.approvals.size === 0) run.record.status = "running";
    emit(run, { type: "tool.approval_resolved", id: block.id, approved });
    audit({ type: "tool.approval_resolved", actor: "user", agentId: run.agent.id, runId: run.record.id, summary: `${approved ? "Aprovou" : "Negou"} ${block.name}` });
    if (!approved) {
      const output = "O usuário NEGOU a execução desta ferramenta. Siga sem ela ou pergunte como prosseguir.";
      emit(run, { type: "tool.result", id: block.id, name: block.name, output, isError: true, durationMs: 0 });
      return { type: "tool_result", tool_use_id: block.id, content: output, is_error: true };
    }
  }

  const started = Date.now();
  let output: string;
  let isError = false;
  try {
    if (!toolEnabled(run.agent, block.name, mcp?.server.name)) throw new Error(`Ferramenta "${block.name}" não está habilitada para este agente.`);
    const builtin = builtinTools[block.name];
    if (builtin) output = await builtin.run(input, ctx);
    else if (mcp) {
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
  return { type: "tool_result", tool_use_id: block.id, content: output, is_error: isError || undefined };
}

async function loop(run: LiveRun) {
  const { agent, record, llm } = run;
  run.busy = true;
  record.status = "running";
  const ctx: ToolContext = {
    agentId: agent.id,
    runId: record.id,
    scratchpad: record.scratchpad,
    onMemoryCreated: (memory) => emit(run, { type: "memory.created", memory }),
  };
  const tools = resolveTools(agent);

  try {
    if (!llmHasCredentials(llm)) {
      throw new Error(
        `A LLM "${llm.name}" não tem chave de API. Abra “LLMs”, cole a chave e tente de novo — ` +
          "ou troque o agente para a LLM “Demo (offline)” para ver o loop funcionando sem chave.",
      );
    }

    let finalText = "";
    const startIteration = record.iterations;
    for (let i = 1; ; i++) {
      const iteration = startIteration + i;
      if (i > agent.maxIterations) throw new Error(`Limite de ${agent.maxIterations} iterações atingido sem concluir a tarefa.`);
      if (run.abort.signal.aborted) throw new DOMException("cancelado", "AbortError");
      record.iterations = iteration;
      emit(run, { type: "iteration.started", iteration });
      emit(run, {
        type: "llm.request",
        iteration,
        messageCount: record.messages.length,
        toolCount: tools.length,
        systemPrompt: record.systemPrompt,
      });
      audit({
        type: "llm.request",
        actor: "agent",
        agentId: agent.id,
        runId: record.id,
        summary: `Iteração ${iteration}: ${record.messages.length} mensagens, ${tools.length} ferramentas → ${llm.name} (${llm.model})`,
        data: { llm: llm.name, provider: llm.provider, model: llm.model, effort: llm.provider === "anthropic" ? llm.effort : undefined, tools: tools.map((t) => t.name) },
      });

      const started = Date.now();
      const turn = await callLlm({
        llm,
        agent,
        run: record,
        system: record.systemPrompt,
        messages: record.messages as Msg[],
        tools,
        signal: run.abort.signal,
        emit: (ev) => emit(run, ev),
      });
      const durationMs = Date.now() - started;
      record.usage.input += turn.usage.input;
      record.usage.output += turn.usage.output;

      emit(run, { type: "llm.response", iteration, stopReason: turn.stopReason, usage: turn.usage, durationMs, model: turn.model });
      const toolUses = (turn.content as { type: string; id?: string; name?: string; input?: unknown }[]).filter((b) => b.type === "tool_use");
      const text = (turn.content as { type: string; text?: string }[])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      audit({
        type: "llm.response",
        actor: "agent",
        agentId: agent.id,
        runId: record.id,
        summary: `Resposta (${turn.stopReason}) — ${toolUses.length} chamadas de ferramenta`,
        durationMs,
        tokens: turn.usage,
        data: { model: turn.model, stopReason: turn.stopReason, text: clip(text, 2000), toolUses: toolUses.map((t) => t.name) },
      });

      // O conteúdo do assistente volta para o histórico exatamente como veio (inclusive blocos de pensamento).
      record.messages.push({ role: "assistant", content: turn.content });

      if (turn.stopReason === "refusal") throw new Error("O modelo recusou a solicitação (stop_reason: refusal).");
      if (turn.stopReason === "pause_turn") continue;
      if (turn.stopReason === "max_tokens" && toolUses.length) throw new Error("Entrada de ferramenta truncada (max_tokens).");
      if (toolUses.length === 0) {
        finalText = text;
        break;
      }

      // Executa as ferramentas em paralelo e devolve TODOS os resultados em uma única mensagem de usuário.
      const results = await Promise.all(toolUses.map((b) => executeTool(run, { id: b.id!, name: b.name!, input: b.input }, ctx)));
      record.messages.push({ role: "user", content: results });
    }

    record.status = "completed";
    record.output = finalText;
    record.finishedAt = now();
    emit(run, { type: "run.completed", output: finalText, iterations: record.iterations, usage: record.usage });
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
      // Resumo curto e sem markdown: episódios longos poluiriam buscas futuras.
      const usedTools = [...new Set(record.events.flatMap((e) => (e.type === "tool.call" ? [e.name] : [])))];
      const plain = finalText.replace(/[*_`>#\-]/g, "").replace(/\s+/g, " ").trim();
      const memory = createMemory({
        content:
          `Episódio: tarefa "${record.input.slice(0, 120)}" concluída em ${record.iterations} iterações` +
          (usedTools.length ? ` usando ${usedTools.join(", ")}` : "") +
          `. Início da resposta: ${plain.slice(0, 140)}${plain.length > 140 ? "…" : ""}`,
        kind: "episode",
        tags: ["episódio", agent.name],
        importance: 2,
        agentId: agent.id,
        source: "auto",
        runId: record.id,
      });
      emit(run, { type: "memory.created", memory });
    }
  } catch (err) {
    record.finishedAt = now();
    if (run.abort.signal.aborted) {
      record.status = "cancelled";
      emit(run, { type: "run.cancelled" });
      audit({ type: "run.cancelled", actor: "user", agentId: agent.id, runId: record.id, summary: "Execução cancelada pelo usuário" });
    } else {
      const message = friendlyLlmError(err) ?? errorMessage(err);
      record.status = "failed";
      record.error = message;
      emit(run, { type: "run.failed", error: message });
      audit({ type: "run.failed", actor: "system", agentId: agent.id, runId: record.id, summary: `Falhou: ${message}` });
    }
  } finally {
    run.busy = false;
    persist();
  }
}

function llmFor(agent: AgentConfig): LlmConfig {
  const llm = db.llms.find((l) => l.id === agent.llmId);
  if (!llm) throw new Error(`O agente "${agent.name}" não tem uma LLM válida. Escolha uma no editor do agente.`);
  return structuredClone(llm);
}

export function startRun(agent: AgentConfig, input: string): RunRecord {
  const llm = llmFor(agent);
  const recalled = agent.memory.autoRecall ? searchMemories(input, { agentId: agent.id, limit: agent.memory.recallLimit, touch: true }) : [];
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
    systemPrompt: buildSystemPrompt(agent, recalled.map((r) => r.memory)),
    scratchpad: [],
  };
  db.runs.push(record);
  const run: LiveRun = { record, agent: structuredClone(agent), llm, abort: new AbortController(), approvals: new Map(), busy: false };
  live.set(record.id, run);

  emit(run, { type: "run.started", runId: record.id, agentId: agent.id, input, provider: llm.provider, model: llm.model, llmName: llm.name });
  audit({
    type: "run.started",
    actor: "user",
    agentId: agent.id,
    runId: record.id,
    summary: `Nova execução de "${agent.name}": ${clip(input, 100)}`,
    data: { input, llm: llm.name, provider: llm.provider, model: llm.model },
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
  void loop(run);
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
  // A conversa continua com a configuração ATUAL do agente (inclusive se você trocou a LLM dele).
  const llm = llmFor(agent);
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
  void loop(run);
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
