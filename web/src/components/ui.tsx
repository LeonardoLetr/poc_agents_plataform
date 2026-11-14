import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-cyan/80">{eyebrow}</div>}
        <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">{title}</h1>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-ink-300">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-2xl ${className}`}>{children}</div>;
}

type Variant = "primary" | "ghost" | "danger" | "subtle";
const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-b from-violet to-[#6d3fe0] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_8px_24px_-8px_rgb(139_92_246/0.7)] hover:brightness-110",
  ghost: "border border-white/10 bg-white/[0.03] text-ink-200 hover:bg-white/[0.07] hover:text-ink-100",
  danger: "border border-rose/30 bg-rose/10 text-rose hover:bg-rose/20",
  subtle: "text-ink-300 hover:bg-white/[0.06] hover:text-ink-100",
};

export function Button({ variant = "ghost", size = "md", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color = "ink", className = "" }: { children: ReactNode; color?: "ink" | "violet" | "cyan" | "mint" | "amber" | "rose" | "pink"; className?: string }) {
  const map = {
    ink: "bg-white/5 text-ink-300 border-white/10",
    violet: "bg-violet/10 text-violet-300 border-violet/25",
    cyan: "bg-cyan/10 text-cyan border-cyan/25",
    mint: "bg-mint/10 text-mint border-mint/25",
    amber: "bg-amber/10 text-amber border-amber/25",
    rose: "bg-rose/10 text-rose border-rose/25",
    pink: "bg-pink/10 text-pink border-pink/25",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${map[color]} ${className}`}>{children}</span>;
}

const field = "w-full rounded-xl border border-white/10 bg-ink-900/70 px-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none transition focus:border-violet/60 focus:ring-4 focus:ring-violet/15";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${field} h-10 ${props.className ?? ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${field} py-2.5 leading-relaxed ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${field} h-10 ${props.className ?? ""}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-200">{label}</span>
        {hint && <span className="text-[11.5px] text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.03]">
      <span className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-violet" : "bg-ink-600"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${checked ? "right-0.5" : "left-0.5"}`} />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-ink-100">{label}</span>
        {description && <span className="block text-[12px] leading-snug text-ink-400">{description}</span>}
      </span>
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-white/10 bg-ink-900/95 p-6 shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-ink-100" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-ink-300">{icon}</div>
      <div className="font-medium text-ink-100">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-sm text-rose">{message}</div>;
}
