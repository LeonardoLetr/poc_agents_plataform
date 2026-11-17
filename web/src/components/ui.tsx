import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      {/* O "eyebrow" virou o breadcrumb da barra superior; aqui fica só título + subtítulo. */}
      <div className="max-w-3xl" data-eyebrow={eyebrow}>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink-100">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-xl ${className}`}>{children}</div>;
}

type Variant = "primary" | "ghost" | "danger" | "subtle";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-[#1d4ed8]",
  ghost: "border border-ink-700 bg-surface text-ink-200 hover:border-ink-600 hover:bg-ink-900 hover:text-ink-100",
  danger: "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
  subtle: "text-ink-400 hover:bg-ink-850 hover:text-ink-100",
};

export function Button({
  variant = "ghost",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  color = "ink",
  className = "",
}: {
  children: ReactNode;
  color?: "ink" | "accent" | "info" | "ok" | "warn" | "bad" | "mcp" | "memory";
  className?: string;
}) {
  const map = {
    // Etiquetas suaves: fundo claro + texto forte da mesma família, sem borda.
    // Tons derivados dos tokens: funcionam em qualquer tema (claro, bege ou escuro).
    ink: "bg-ink-850 text-ink-400",
    accent: "bg-accent/10 text-accent",
    info: "bg-info/10 text-info",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/12 text-warn",
    bad: "bg-bad/10 text-bad",
    mcp: "bg-mcp/10 text-mcp",
    memory: "bg-memory/10 text-memory",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 py-[2px] text-[11px] font-medium leading-none ${map[color]} ${className}`}
    >
      {children}
    </span>
  );
}

const field =
  "w-full rounded-lg border border-ink-700 bg-surface px-3 text-[13px] text-ink-100 placeholder:text-ink-500 outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent/20";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${field} h-8 ${props.className ?? ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${field} py-2.5 leading-relaxed ${props.className ?? ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${field} h-8 ${props.className ?? ""}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-200">{label}</span>
        {hint && <span className="text-[11.5px] text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-ink-900"
    >
      <span className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-ink-600"}`}>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow ${checked ? "right-0.5" : "left-0.5"}`}
        />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-ink-100">{label}</span>
        {description && <span className="block text-[12px] leading-snug text-ink-400">{description}</span>}
      </span>
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={`relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-ink-700 bg-surface p-5 shadow-[0_8px_24px_rgb(0_0_0/0.08)] ${wide ? "max-w-3xl" : "max-w-lg"}`}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-[15px] font-semibold text-ink-100">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-850 hover:text-ink-100"
                aria-label="Fechar"
              >
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

/** Abas em linha, para dividir formulários longos. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: readonly { value: T; label: ReactNode }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-700">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] transition ${
            value === item.value ? "border-accent font-medium text-ink-100" : "border-transparent text-ink-400 hover:text-ink-200"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700 px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-850 text-ink-300">{icon}</div>
      <div className="font-medium text-ink-100">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{message}</div>;
}
