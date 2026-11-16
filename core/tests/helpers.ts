import type { RunEvent } from "../types.js";

/**
 * Inicializa um núcleo isolado para testes: armazenamento em memória, modo servidor
 * (sem chaves de ambiente) e LLM demo sem atrasos artificiais.
 */
export async function bootCore() {
  const core = await import("../index.js");
  const store = await import("../store.js");
  core.initCore({
    runtime: "server",
    storage: { load: () => null, save: () => undefined },
    demoDelayScale: 0,
  });
  const api = async <T = any>(method: string, path: string, body?: unknown, query: Record<string, string> = {}) => {
    const res = await core.handle({ method, path, query, body: body ?? {} });
    return res as { status: number; body: T };
  };
  return { core, api, db: store.db };
}

type Core = Awaited<ReturnType<typeof bootCore>>["core"];
export type StreamEvent = RunEvent & { ts?: string };

/**
 * Coleta os eventos de uma execução até ela terminar (concluída, falha ou cancelada).
 * `ignoreSnapshot`: descarta o histórico enviado na assinatura (útil ao continuar uma conversa).
 */
export function collectRun(
  core: Core,
  runId: string,
  opts: { onEvent?: (e: StreamEvent) => void; ignoreSnapshot?: boolean; timeoutMs?: number } = {},
): Promise<StreamEvent[]> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    const events: StreamEvent[] = [];
    let stop: (() => void) | null = null;
    const timer = setTimeout(() => {
      stop?.();
      reject(new Error(`Execução ${runId} não terminou em ${timeoutMs}ms. Eventos: ${events.map((e) => e.type).join(", ")}`));
    }, timeoutMs);
    stop = core.subscribe(`/api/runs/${runId}/stream`, (msg) => {
      const m = msg as { type: string; events?: StreamEvent[] };
      if (m.type === "snapshot" && opts.ignoreSnapshot) return;
      const batch = m.type === "snapshot" ? (m.events ?? []) : [m as StreamEvent];
      for (const e of batch) {
        events.push(e);
        opts.onEvent?.(e);
        if (e.type === "run.completed" || e.type === "run.failed" || e.type === "run.cancelled") {
          clearTimeout(timer);
          queueMicrotask(() => stop?.());
          resolve(events);
          return;
        }
      }
    });
  });
}

/** Aguarda uma condição assíncrona (ex.: servidor MCP conectado). */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000, label = "condição") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Tempo esgotado aguardando ${label}`);
}

export const types = (events: StreamEvent[]) => events.map((e) => e.type);
