import { motion } from "motion/react";

/**
 * Diagrama animado do loop agêntico: um "pacote" de informação circula por
 * contexto → LLM → ferramenta → observação, e cada estação acende quando ele passa.
 */
const STATIONS = [
  { label: "Contexto", sub: "prompt + memória + histórico", color: "#4a7a96", angle: -90 },
  { label: "Pensar", sub: "LLM decide o próximo passo", color: "#c96442", angle: 0 },
  { label: "Agir", sub: "chama uma ferramenta", color: "#b07a1e", angle: 90 },
  { label: "Observar", sub: "resultado volta ao contexto", color: "#5e8c4a", angle: 180 },
];

export function LoopDiagram({ size = 340, duration = 8 }: { size?: number; duration?: number }) {
  const r = size * 0.36;
  const c = size / 2;
  const path = `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 overflow-visible">
        <defs>
          <linearGradient id="loop-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4a7a96" />
            <stop offset="35%" stopColor="#c96442" />
            <stop offset="65%" stopColor="#b07a1e" />
            <stop offset="100%" stopColor="#5e8c4a" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="url(#loop-grad)" strokeOpacity={0.25} strokeWidth={2} strokeDasharray="4 8" />
        <motion.circle cx={c} cy={c} r={r} fill="none" stroke="url(#loop-grad)" strokeWidth={2} strokeLinecap="round" initial={{ pathLength: 0, rotate: -90 }} animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0] }} transition={{ duration, repeat: Infinity, ease: "linear", times: [0, 0.98, 1] }} style={{ originX: "50%", originY: "50%" }} />
        <circle r={5} fill="var(--color-accent)">
          <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={path} />
        </circle>
      </svg>
      {STATIONS.map((s, i) => {
        const rad = (s.angle * Math.PI) / 180;
        const x = c + Math.cos(rad) * r;
        const y = c + Math.sin(rad) * r;
        const t = i / STATIONS.length;
        return (
          <motion.div
            key={s.label}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: x, top: y }}
          >
            <motion.div
              className="flex h-12 w-12 items-center justify-center rounded-2xl border text-[11px] font-semibold"
              style={{ borderColor: `${s.color}55`, color: s.color, backgroundColor: "#ffffff" }}
              animate={{ backgroundColor: ["#ffffff", `color-mix(in oklab, ${s.color} 14%, #ffffff)`, "#ffffff"], scale: [1, 1.08, 1] }}
              transition={{ duration: duration * 0.18, repeat: Infinity, repeatDelay: duration * 0.82, delay: t * duration }}
            >
              {i + 1}
            </motion.div>
            <div className="mt-1.5 whitespace-nowrap text-center">
              <div className="text-[12.5px] font-semibold text-ink-100">{s.label}</div>
              <div className="max-w-[130px] text-[10.5px] leading-tight text-ink-400">{s.sub}</div>
            </div>
          </motion.div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="font-serif text-[26px] italic text-ink-100">loop</div>
        <div className="font-mono text-[10px] text-ink-400">repete até end_turn</div>
      </div>
    </div>
  );
}
