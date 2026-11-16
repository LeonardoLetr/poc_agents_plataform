import { motion } from "motion/react";
import { Gauge, Scissors } from "lucide-react";
import { fmtNumber } from "../lib/format";
import type { ContextPoint } from "../lib/runState";
import { Card } from "./ui";

/**
 * Medidor da janela de contexto: quanto do limite do modelo cada iteração ocupou,
 * onde o resumo automático dispara e do que o contexto é feito.
 */
export function ContextMeter({ points, threshold }: { points: ContextPoint[]; threshold?: { autoCompact: boolean; thresholdPct: number } | undefined }) {
  const last = points[points.length - 1];
  const pct = last ? Math.min(100, (last.tokens / last.window) * 100) : 0;
  const limit = threshold?.autoCompact ? threshold.thresholdPct : null;
  const tone = pct >= 90 ? "bg-bad" : limit !== null && pct >= limit ? "bg-warn" : "bg-accent";
  const max = Math.max(1, ...points.map((p) => p.tokens));
  const parts = last ? [
    { label: "Sistema", value: last.breakdown.system, color: "bg-info" },
    { label: "Ferramentas", value: last.breakdown.tools, color: "bg-mcp" },
    { label: "Histórico", value: last.breakdown.history, color: "bg-accent" },
  ] : [];
  const partsTotal = Math.max(1, parts.reduce((a, p) => a + p.value, 0));

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
        <Gauge size={15} className="text-info" /> Janela de contexto
        <span className="ml-auto text-[12px] font-normal tabular-nums text-ink-400">
          {last ? `${fmtNumber(last.tokens)} de ${fmtNumber(last.window)} tokens` : "sem medições"}
        </span>
      </div>

      {!last ? (
        <p className="mt-3 text-[12.5px] text-ink-400">Execute uma tarefa para medir quanto da janela cada iteração ocupa.</p>
      ) : (
        <>
          {/* Ocupação atual com o limite do resumo automático */}
          <div className="mt-3 flex items-end justify-between">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink-100">{pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</span>
            <span className="text-[11.5px] text-ink-400">{limit !== null ? `resumo automático em ${limit}%` : "resumo automático desligado"}</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-ink-850">
            <motion.div className={`h-full rounded-full ${tone}`} initial={false} animate={{ width: `${Math.max(pct, 0.6)}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
            {limit !== null && <div className="absolute -top-1 h-4 w-px bg-ink-300" style={{ left: `${limit}%` }} title={`Limite: ${limit}%`} />}
          </div>

          {/* Evolução por iteração; a tesoura marca onde o histórico foi resumido */}
          <div className="mt-4 flex h-16 items-end gap-1" aria-label="Tokens de entrada por iteração">
            {points.map((p) => (
              <div key={p.iteration} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Iteração ${p.iteration}: ${fmtNumber(p.tokens)} tokens · ${p.messageCount} mensagens`}>
                {p.compactedBefore && <Scissors size={11} className="shrink-0 text-memory" />}
                <motion.div
                  className={`w-full max-w-6 rounded-t-[3px] ${p.compactedBefore ? "bg-memory/70" : "bg-accent/70"}`}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(6, (p.tokens / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-ink-500">
            <span>it. {points[0]?.iteration}</span>
            <span>it. {last.iteration}</span>
          </div>

          {/* Composição estimada do contexto enviado na última iteração */}
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-ink-850">
            {parts.map((p) => <div key={p.label} className={p.color} style={{ width: `${(p.value / partsTotal) * 100}%` }} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-400">
            {parts.map((p) => (
              <span key={p.label} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${p.color}`} /> {p.label} ~{fmtNumber(p.value)}
              </span>
            ))}
            {last.cacheRead > 0 && <span className="ml-auto text-ok">cache lido {Math.round((last.cacheRead / last.tokens) * 100)}%</span>}
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-500">Total medido pela API; composição estimada (≈ 4 caracteres por token).</p>
        </>
      )}
    </Card>
  );
}
