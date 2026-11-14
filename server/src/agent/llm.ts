import Anthropic from "@anthropic-ai/sdk";
import { db } from "../store.js";

/** Modelos oferecidos na UI. */
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "padrão — melhor equilíbrio para agentes", fallback: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "rápido e capaz", fallback: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "mais barato, ótimo para subtarefas", fallback: false },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", note: "o mais capaz (mais caro)", fallback: true },
] as const;

/** Preço por 1M de tokens (US$) para estimar custo na auditoria. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
};

export function supportsServerFallback(model: string) {
  return MODELS.some((m) => m.id === model && m.fallback);
}

export function hasCredentials(): boolean {
  return Boolean(db.settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let cached: { key: string | undefined; client: Anthropic } | null = null;

export function getClient(): Anthropic {
  const key = db.settings.anthropicApiKey;
  if (!cached || cached.key !== key) {
    // Sem chave salva na UI, o SDK resolve as credenciais do ambiente (ANTHROPIC_API_KEY etc.).
    cached = { key, client: key ? new Anthropic({ apiKey: key }) : new Anthropic() };
  }
  return cached.client;
}
