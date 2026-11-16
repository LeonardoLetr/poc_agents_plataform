import type { RunEvent } from "./api";
import { emptyRun, reduceRun, type RunView } from "./runState";

/**
 * Replay de execuções: reconstrói o estado da tela a partir dos eventos salvos.
 * `position` é quantos eventos já foram aplicados (0 = antes do primeiro, events.length = estado final).
 */

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;

/** Estado da execução depois de aplicar os primeiros `position` eventos. */
export function viewAt(events: RunEvent[], position: number): RunView {
  return events.slice(0, Math.max(0, Math.min(position, events.length))).reduce(reduceRun, emptyRun);
}

/** Posições em que cada iteração começa (logo depois de aplicar o evento iteration.started). */
export function iterationStarts(events: RunEvent[]): number[] {
  const out: number[] = [];
  events.forEach((e, i) => {
    if (e.type === "iteration.started") out.push(i + 1);
  });
  return out;
}

/** Próxima (ou anterior) posição de início de iteração a partir da posição atual. */
export function jumpIteration(events: RunEvent[], position: number, direction: 1 | -1): number {
  const starts = iterationStarts(events);
  if (direction === 1) return starts.find((s) => s > position) ?? events.length;
  return [...starts].reverse().find((s) => s < position) ?? 0;
}

/**
 * Espera até mostrar o próximo evento: o intervalo real entre os eventos, dividido pela velocidade
 * e limitado entre 80 ms e 1,5 s (pausas longas, como a espera por aprovação, não travam o replay).
 */
export function replayDelay(events: RunEvent[], position: number, speed: number): number {
  const prev = events[position - 1];
  const next = events[position];
  if (!prev || !next) return 400 / speed;
  const real = new Date(next.ts).getTime() - new Date(prev.ts).getTime();
  const scaled = (Number.isFinite(real) ? real : 400) / speed;
  return Math.min(1500, Math.max(80, scaled));
}

/** Iteração em que a posição está (0 antes da primeira). */
export function iterationAt(events: RunEvent[], position: number): number {
  return iterationStarts(events).filter((s) => s <= position).length;
}
