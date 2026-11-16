import { motion, useInView, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Efeitos visuais. Animações são usadas apenas para indicar mudança de estado
 * ou atividade em andamento.
 */

/** Fundo da página: o bege liso do <body>. Mantido como componente para trocar de tema no futuro. */
export function Aurora() {
  return null;
}

/** Cartão branco que só escurece a borda ao passar o mouse. */
export function SpotlightCard({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className={`glass relative overflow-hidden rounded-2xl transition-colors hover:border-ink-600 ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** Contador que anima até o valor (estilo "number ticker"). */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 40, stiffness: 120 });
  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);
  useEffect(
    () =>
      spring.on("change", (v) => {
        if (ref.current)
          ref.current.textContent =
            prefix +
            new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v) +
            suffix;
      }),
    [spring, decimals, prefix, suffix],
  );
  const initial =
    prefix + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(0) + suffix;
  return (
    <span ref={ref} className="tabular-nums">
      {initial}
    </span>
  );
}

/** Texto que aparece palavra por palavra com desfoque (estilo "blur fade"). */
export function BlurText({
  text,
  className = "",
  wordClassName = "",
  delay = 0,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
}) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <motion.span
          key={i}
          className={`inline-block ${wordClassName}`}
          initial={{ opacity: 0, filter: "blur(4px)", y: 6 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.5, delay: delay + i * 0.06, ease: [0.2, 0.65, 0.3, 0.9] }}
        >
          {w}&nbsp;
        </motion.span>
      ))}
    </span>
  );
}

/** Ponto pulsante para status "ao vivo". */
export function LiveDot({ color = "bg-ok", active = true }: { color?: string; active?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {active && <span className={`absolute inline-flex h-full w-full rounded-full ${color} animate-pulse-ring`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${active ? color : "bg-ink-500"}`} />
    </span>
  );
}
