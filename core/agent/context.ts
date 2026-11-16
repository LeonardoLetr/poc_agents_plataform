/**
 * Gestão da janela de contexto.
 *
 * A cada iteração o histórico inteiro é reenviado ao modelo. Este módulo mede quanto da janela está em uso
 * e, quando o agente pede, substitui o histórico por um resumo ("compactação simples"): o resumo é gerado
 * pelo próprio modelo com o histórico completo e a próxima requisição começa só com ele.
 *
 * Por que não manter as últimas mensagens literalmente? Modelos com raciocínio preservado vinculam cada bloco de
 * pensamento ao histórico que o gerou; reenviar turnos antigos depois de trocar o início do histórico é rejeitado.
 * O resumo completo não reaproveita nada e é o formato recomendado pela Anthropic.
 */

/** Marcadores reconhecidos também pela LLM demo. */
export const SUMMARY_REQUEST_MARKER = "[resumo-do-contexto]";
export const COMPACTED_MARKER = "[contexto-resumido]";

export const SUMMARY_PROMPT =
  `${SUMMARY_REQUEST_MARKER} Resuma a conversa até aqui dentro de <summary></summary>. O resumo vai substituir o histórico, ` +
  "então a tarefa deve poder continuar sem refazer trabalho nem pedir de novo informações já dadas. Preserve: " +
  "(1) problemas encontrados e como foram resolvidos; (2) abordagens tentadas ou descartadas, e por quê; " +
  "(3) o que foi pedido, decidido ou estabelecido como preferência ou restrição, com as palavras exatas; " +
  "(4) onde a tarefa está agora, o que já foi concluído; (5) o que ainda está pendente; " +
  "(6) detalhes difíceis de reconstruir (nomes, números, datas, URLs, resultados de ferramentas), exatamente como apareceram. " +
  "Mantenha o que o usuário disse próximo das palavras dele; suas próprias explicações podem ser condensadas. " +
  "Não chame nenhuma ferramenta ao escrever este resumo; responda apenas com texto.";

/** Estimativa simples de tokens (≈ 4 caracteres por token), usada só para o detalhamento visual. */
export const estimateTokens = (value: unknown) => Math.ceil((typeof value === "string" ? value : JSON.stringify(value ?? "")).length / 4);

export function contextBreakdown(system: string, tools: unknown[], messages: unknown[]) {
  return { system: estimateTokens(system), tools: estimateTokens(tools), history: estimateTokens(messages) };
}

/** Fração estimada do contexto ocupada pelo histórico de mensagens. */
export function historyShare(system: string, tools: unknown[], messages: unknown[]): number {
  const b = contextBreakdown(system, tools, messages);
  return b.history / Math.max(1, b.system + b.tools + b.history);
}

/** Parcela mínima do contexto que precisa ser histórico para o resumo compensar. */
export const MIN_HISTORY_SHARE = 0.4;
export const MIN_ITERATIONS_BETWEEN_COMPACTIONS = 2;

/**
 * Deve compactar antes da próxima chamada? Além do limite da janela, o histórico precisa ser uma parte relevante
 * do contexto: se o grosso for prompt de sistema e definições de ferramentas, resumir não libera espaço.
 */
export function shouldCompact(opts: {
  enabled: boolean;
  thresholdPct: number;
  tokens: number;
  window: number;
  messageCount: number;
  historyShare: number;
  /** O resumo só substitui um histórico com a rodada anterior respondida (última mensagem do usuário). */
  lastMessageFromUser: boolean;
  /** Iterações desde o último resumo desta execução; `null` se ainda não houve. */
  iterationsSinceCompaction: number | null;
}): boolean {
  if (!opts.enabled || opts.window <= 0 || opts.messageCount < 3 || !opts.lastMessageFromUser) return false;
  // Com um limite muito baixo, o resumo não pode virar um loop de custo.
  if (opts.iterationsSinceCompaction !== null && opts.iterationsSinceCompaction < MIN_ITERATIONS_BETWEEN_COMPACTIONS) return false;
  if (opts.historyShare < MIN_HISTORY_SHARE) return false;
  return (opts.tokens / opts.window) * 100 >= opts.thresholdPct;
}

export function extractSummary(text: string): string {
  const m = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  return (m?.[1] ?? text).trim();
}

/** Mensagem que inicia o histórico compactado. */
export function compactedMessage(task: string, summary: string): string {
  return (
    `${COMPACTED_MARKER} O histórico anterior desta tarefa foi resumido para liberar a janela de contexto.\n\n` +
    `Tarefa original: ${task}\n\n<summary>\n${summary}\n</summary>\n\nContinue a partir deste ponto, sem refazer o que já foi concluído.`
  );
}
