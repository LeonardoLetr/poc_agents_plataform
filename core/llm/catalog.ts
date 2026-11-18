import type { LlmConfig, RunRecord } from "../types.js";
import { eventsOfType } from "../util.js";

/** Sugestões exibidas na UI ao cadastrar uma LLM. O campo de modelo é livre: qualquer id funciona. */

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "padrão — ótimo equilíbrio para agentes", fallback: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "rápido e capaz", fallback: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "mais barato, bom para subtarefas", fallback: false },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", note: "o mais capaz (mais caro)", fallback: true },
] as const;

export const OPENAI_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", needsKey: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini", needsKey: true },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.2", needsKey: false },
] as const;

export type Price = { input: number; output: number };

/** Preço por 1M de tokens (US$) dos modelos do catálogo. Outros modelos dependem do preço informado na LLM. */
export const PRICING: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
};

/** Janela de contexto (tokens) dos modelos do catálogo. */
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
  "claude-fable-5-2": 1_000_000,
};

/** Padrões quando o modelo não está no catálogo. O demo usa uma janela pequena para o resumo ser visível. */
const DEFAULT_WINDOW = { anthropic: 200_000, openai: 128_000, demo: 4_000 } as const;

export function contextWindowFor(llm: {
  provider: keyof typeof DEFAULT_WINDOW;
  model: string;
  contextWindow?: number | undefined;
}): number {
  return llm.contextWindow || CONTEXT_WINDOWS[llm.model] || DEFAULT_WINDOW[llm.provider];
}

export function supportsServerFallback(model: string) {
  return ANTHROPIC_MODELS.some((m) => m.id === model && m.fallback);
}

/**
 * Preço de uma chamada: o informado na LLM; senão o do catálogo pelo modelo; a LLM demo não cobra. `null` quando não
 * há como estimar (modelo fora do catálogo e sem preço informado).
 */
export function priceFor(llm: { provider: string; model: string; pricing?: Price | undefined }): Price | null {
  if (llm.pricing) return llm.pricing;
  if (llm.provider === "demo") return { input: 0, output: 0 };
  return PRICING[llm.model] ?? null;
}

export const costUsd = (usage: { input: number; output: number }, price: Price) =>
  (usage.input * price.input + usage.output * price.output) / 1e6;

/**
 * Custo estimado de uma execução (sem as filhas, que têm registro próprio): preço atual da LLM usada, com o provedor e
 * o modelo registrados no início. `null` quando não há preço.
 */
export function runCost(run: RunRecord, llms: readonly LlmConfig[]): number | null {
  const [started] = eventsOfType(run.events, "run.started");
  const llm = llms.find((l) => l.id === run.llmId);
  const price = priceFor({
    provider: started?.provider ?? llm?.provider ?? "",
    model: started?.model ?? llm?.model ?? "",
    pricing: llm?.pricing,
  });
  return price ? costUsd(run.usage, price) : null;
}
