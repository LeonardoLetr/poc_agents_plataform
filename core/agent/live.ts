import { persist } from "../store.js";
import type { AgentConfig, LlmConfig, RunEvent, RunRecord } from "../types.js";
import { bus, now } from "../util.js";

/** Estado das execuções em andamento e a emissão de eventos (linha do tempo ao vivo e histórico salvo). */

export type LiveRun = {
  record: RunRecord;
  agent: AgentConfig;
  llm: LlmConfig;
  abort: AbortController;
  approvals: Map<string, (approved: boolean) => void>;
  busy: boolean;
  /** Resolve quando o loop atual termina (usado pela delegação para aguardar a filha). */
  finished?: Promise<void>;
};

export const live = new Map<string, LiveRun>();

export function emit(run: LiveRun, ev: RunEvent) {
  const events = run.record.events;
  const last = events[events.length - 1];
  // Deltas de texto/pensamento são agrupados no histórico salvo (mas transmitidos um a um ao vivo).
  if (
    last &&
    (ev.type === "text.delta" || ev.type === "thinking.delta") &&
    (last.type === "text.delta" || last.type === "thinking.delta") &&
    last.type === ev.type
  ) {
    last.text += ev.text;
  } else {
    events.push({ ...ev, ts: now(), seq: events.length });
  }
  bus.emit(`run:${run.record.id}`, { ...ev, ts: now() });
  if (ev.type !== "text.delta" && ev.type !== "thinking.delta") persist();
}
