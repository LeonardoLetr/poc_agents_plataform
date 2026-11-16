import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play, X } from "lucide-react";
import { useEffect } from "react";
import type { RunEvent } from "../lib/api";
import { iterationAt, iterationStarts, jumpIteration, REPLAY_SPEEDS, replayDelay } from "../lib/replay";
import { Card } from "./ui";

export interface ReplayState {
  /** Eventos aplicados; null = fora do replay (estado final). */
  position: number | null;
  playing: boolean;
  speed: number;
}

export const replayOff: ReplayState = { position: null, playing: false, speed: 1 };

const iconButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-700 text-ink-300 transition-colors hover:bg-ink-850 hover:text-ink-100 disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Barra de replay: avança e retrocede pelos eventos salvos de uma execução concluída.
 * Grafo, linha do tempo, métricas e medidor de contexto acompanham a posição.
 */
export function ReplayBar({ events, state, onChange }: { events: RunEvent[]; state: ReplayState; onChange: (s: ReplayState) => void }) {
  const total = events.length;
  const position = state.position ?? total;
  const set = (p: number, extra: Partial<ReplayState> = {}) => onChange({ ...state, ...extra, position: Math.max(0, Math.min(total, p)) });

  // Reprodução automática no ritmo real da execução (ajustado pela velocidade).
  useEffect(() => {
    if (!state.playing || state.position === null) return;
    if (state.position >= total) {
      onChange({ ...state, playing: false });
      return;
    }
    const timer = setTimeout(() => onChange({ ...state, position: (state.position ?? 0) + 1 }), replayDelay(events, state.position, state.speed));
    return () => clearTimeout(timer);
  }, [state, events, total, onChange]);

  // Atalhos: espaço reproduz/pausa, setas avançam por evento (com Shift, por iteração).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.position === null || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === " ") {
        e.preventDefault();
        onChange({ ...state, playing: !state.playing, position: position >= total ? 0 : position });
      } else if (e.key === "ArrowRight") set(e.shiftKey ? jumpIteration(events, position, 1) : position + 1, { playing: false });
      else if (e.key === "ArrowLeft") set(e.shiftKey ? jumpIteration(events, position, -1) : position - 1, { playing: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (state.position === null) {
    return (
      <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="text-[13px] text-ink-300">Reveja esta execução evento por evento, com o grafo e a linha do tempo acompanhando.</span>
        <button onClick={() => onChange({ ...state, position: 0, playing: true })} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:opacity-90">
          <Play size={13} /> Reproduzir
        </button>
      </Card>
    );
  }

  const starts = iterationStarts(events);
  const current = events[position - 1];
  return (
    <Card className="mb-4 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] font-medium text-ink-100">Replay</span>
        <button className={iconButton} onClick={() => set(jumpIteration(events, position, -1), { playing: false })} disabled={position === 0} aria-label="Iteração anterior" title="Iteração anterior (Shift + ←)">
          <ChevronsLeft size={15} />
        </button>
        <button className={iconButton} onClick={() => set(position - 1, { playing: false })} disabled={position === 0} aria-label="Evento anterior" title="Evento anterior (←)">
          <ChevronLeft size={15} />
        </button>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:opacity-90"
          onClick={() => onChange({ ...state, playing: !state.playing, position: position >= total ? 0 : position })}
          aria-label={state.playing ? "Pausar" : "Reproduzir"}
          title="Reproduzir ou pausar (espaço)"
        >
          {state.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className={iconButton} onClick={() => set(position + 1, { playing: false })} disabled={position >= total} aria-label="Próximo evento" title="Próximo evento (→)">
          <ChevronRight size={15} />
        </button>
        <button className={iconButton} onClick={() => set(jumpIteration(events, position, 1), { playing: false })} disabled={position >= total} aria-label="Próxima iteração" title="Próxima iteração (Shift + →)">
          <ChevronsRight size={15} />
        </button>
        <div className="ml-1 flex rounded-lg border border-ink-700 p-0.5" role="group" aria-label="Velocidade">
          {REPLAY_SPEEDS.map((s) => (
            <button key={s} onClick={() => onChange({ ...state, speed: s })} className={`h-6 rounded-md px-2 text-[11.5px] tabular-nums transition-colors ${state.speed === s ? "bg-ink-850 font-medium text-ink-100" : "text-ink-400 hover:text-ink-100"}`}>
              {s}×
            </button>
          ))}
        </div>
        <button onClick={() => onChange({ ...state, position: null, playing: false })} className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-400 hover:bg-ink-850 hover:text-ink-100">
          <X size={13} /> Sair do replay
        </button>
      </div>

      {/* Linha do tempo com marcas de início de iteração */}
      <div className="relative mt-3">
        <input
          type="range"
          min={0}
          max={total}
          value={position}
          onChange={(e) => set(Number(e.target.value), { playing: false })}
          className="w-full accent-[var(--color-accent)]"
          aria-label="Posição no replay"
        />
        <div className="pointer-events-none relative h-3">
          {starts.map((s, i) => (
            <span key={s} className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-ink-500" style={{ left: `${(s / Math.max(1, total)) * 100}%` }}>
              {i + 1}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-ink-400">
        <span className="tabular-nums">
          evento {position} de {total} · iteração {iterationAt(events, position)} de {starts.length}
        </span>
        {current && <span className="truncate font-mono text-[11px]">{current.type}</span>}
      </div>
    </Card>
  );
}
