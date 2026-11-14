import { motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Efeitos visuais inspirados em bibliotecas como Magic UI, React Bits e
 * Aceternity — reimplementados aqui com `motion` para você estudar o código.
 */

/** Fundo "aurora": manchas de gradiente borradas que flutuam lentamente. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="lab-grid absolute inset-0" />
      <div className="absolute -top-40 left-[10%] h-[520px] w-[520px] rounded-full bg-violet/25 blur-[120px] animate-float" />
      <div className="absolute -top-20 right-[5%] h-[440px] w-[440px] rounded-full bg-cyan/15 blur-[120px] animate-float [animation-delay:-5s]" />
      <div className="absolute top-[45%] left-[40%] h-[380px] w-[380px] rounded-full bg-mint/10 blur-[130px] animate-float [animation-delay:-9s]" />
    </div>
  );
}

/** Cartão com holofote que segue o mouse. */
export function SpotlightCard({ children, className = "", color = "139 92 246", onClick }: { children: ReactNode; className?: string; color?: string; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const bg = useTransform([x, y], ([lx, ly]) => `radial-gradient(380px circle at ${lx}px ${ly}px, rgb(${color} / 0.14), transparent 70%)`);
  return (
    <motion.div
      ref={ref}
      onClick={onClick}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onMouseLeave={() => {
        x.set(-300);
        y.set(-300);
      }}
      className={`glass group relative overflow-hidden rounded-2xl ${className}`}
    >
      <motion.div className="pointer-events-none absolute inset-0 transition-opacity" style={{ background: bg }} />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/** Contador que anima até o valor (estilo "number ticker"). */
export function NumberTicker({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
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
        if (ref.current) ref.current.textContent = prefix + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v) + suffix;
      }),
    [spring, decimals, prefix, suffix],
  );
  const initial = prefix + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(0) + suffix;
  return <span ref={ref} className="tabular-nums">{initial}</span>;
}

/** Texto que aparece palavra por palavra com desfoque (estilo "blur fade"). */
export function BlurText({ text, className = "", wordClassName = "", delay = 0 }: { text: string; className?: string; wordClassName?: string; delay?: number }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <motion.span
          key={i}
          className={`inline-block ${wordClassName}`}
          initial={{ opacity: 0, filter: "blur(10px)", y: 8 }}
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
export function LiveDot({ color = "bg-mint", active = true }: { color?: string; active?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {active && <span className={`absolute inline-flex h-full w-full rounded-full ${color} animate-pulse-ring`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${active ? color : "bg-ink-500"}`} />
    </span>
  );
}
