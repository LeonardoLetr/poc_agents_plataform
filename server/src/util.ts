import { randomUUID } from "node:crypto";

export const uid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
