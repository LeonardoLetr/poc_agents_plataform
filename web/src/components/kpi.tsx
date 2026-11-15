import type { ReactNode } from "react";

/**
 * Cartão de KPI e microvisualizações (sem eixos nem grades), no padrão de painéis SaaS:
 * rótulo com ícone, valor grande, legenda e um gráfico mínimo no rodapé.
 */
export function KpiCard({
  icon,
  iconColor,
  label,
  value,
  caption,
  aside,
  children,
}: {
  icon: ReactNode;
  iconColor: string;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[148px] flex-col rounded-xl border border-ink-700 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] text-white" style={{ background: iconColor }}>
          {icon}
        </span>
        <span className="text-[12px] text-ink-400">{label}</span>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink-100 tabular-nums">{value}</div>
      {caption && <div className="mt-1.5 text-[12px] text-ink-400">{caption}</div>}
      <div className="mt-auto pt-3">{children}</div>
    </div>
  );
}

/** Completa a série à esquerda com zeros: com poucos dados o gráfico mantém a largura e mostra marcadores neutros. */
const pad = (values: number[], length: number) => [...Array(Math.max(0, length - values.length)).fill(0), ...values.slice(-length)];

/** Barras finas verticais (ex.: tokens por execução). */
export function BarSpark({ values, color = "#3b82f6", height = 28, length = 40 }: { values: number[]; color?: string; height?: number; length?: number }) {
  const max = Math.max(1, ...values);
  const data = pad(values, length);
  return (
    <div className="flex items-end gap-[3px] overflow-hidden" style={{ height }}>
      {data.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: v ? color : "#e4e4e7", opacity: v ? 0.35 + 0.65 * (v / max) : 1 }}
        />
      ))}
    </div>
  );
}

/** Histograma de pontos (ex.: iterações por execução). */
export function DotHistogram({ values, color = "#f97316", rows = 5, length = 28 }: { values: number[]; color?: string; rows?: number; length?: number }) {
  const max = Math.max(1, ...values);
  const data = pad(values, length);
  return (
    <div className="flex items-end gap-[4px] overflow-hidden">
      {data.map((v, i) => {
        const lit = Math.round((v / max) * rows);
        return (
          <div key={i} className="flex flex-col-reverse gap-[3px]">
            {Array.from({ length: rows }, (_, r) => (
              <span key={r} className="h-[3px] w-[3px] rounded-full" style={{ background: r < lit ? color : "#e4e4e7" }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Barra de progresso com raio total. */
export function Progress({ value, color = "#22c55e", height = 6 }: { value: number; color?: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-ink-850" style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}
