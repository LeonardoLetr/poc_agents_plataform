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

/** Preço por 1M de tokens (US$) para estimar custo na auditoria. Modelos desconhecidos não entram na conta. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
};

export function supportsServerFallback(model: string) {
  return ANTHROPIC_MODELS.some((m) => m.id === model && m.fallback);
}
