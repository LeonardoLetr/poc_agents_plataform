import type { RunEvent } from "./types.js";

export const uid = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
export const now = () => new Date().toISOString();

/** Trunca textos longos para logs/auditoria sem perder a indicação do tamanho original. */
export function clip(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${text.length - max} caracteres omitidos]`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Emissor de eventos mínimo: liga o núcleo às telas ao vivo (execuções, auditoria, MCP). */
export class Emitter {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();
  on(event: string, fn: (payload: unknown) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(fn);
    this.handlers.set(event, handlers);
    return () => this.off(event, fn);
  }
  off(event: string, fn: (payload: unknown) => void) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event: string, payload: unknown) {
    for (const fn of this.handlers.get(event) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

export const bus = new Emitter();

/** Objeto simples (não nulo nem lista), com campos ainda por verificar. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Eventos de um tipo, já estreitados para a variante correspondente da união. */
export function eventsOfType<T extends RunEvent["type"]>(events: readonly RunEvent[], type: T): Extract<RunEvent, { type: T }>[] {
  return events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);
}

/** JSON vindo de fora (modelo, stream, servidor): texto inválido vira `undefined`, para o chamador decidir. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
