import { audit } from "../audit.js";
import { callLlm } from "../llm/index.js";
import { contextWindowFor } from "../llm/catalog.js";
import { compactedMessage, historyShare, estimateTokens, extractSummary, shouldCompact, SUMMARY_PROMPT } from "./context.js";
import { turnText } from "./turn.js";
import { clip, now } from "../util.js";
import { type LiveRun, emit } from "./live.js";
import { type RunTools } from "./tools.js";

/** Resumo automático do histórico durante a execução (as regras ficam em context.ts). */

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

export async function compactIfNeeded(run: LiveRun, tools: RunTools, iteration: number) {
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
