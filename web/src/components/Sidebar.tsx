import { motion } from "motion/react";
import { Activity, BookOpen, Bot, Brain, FileText, LayoutDashboard, Plug, Play, Settings, ShieldCheck } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { LiveDot } from "./effects";

const NAV = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/playground", label: "Playground", icon: Play, highlight: true },
  { to: "/agents", label: "Agentes", icon: Bot },
  { to: "/mcp", label: "Servidores MCP", icon: Plug },
  { to: "/memory", label: "Memória", icon: Brain },
  { to: "/prompts", label: "Prompts", icon: FileText },
  { to: "/audit", label: "Auditoria", icon: ShieldCheck },
  { to: "/learn", label: "Aprender", icon: BookOpen },
];

export function Sidebar({ configured }: { configured: boolean | null }) {
  const { pathname } = useLocation();
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  return (
    <aside className="sticky top-0 z-20 flex h-auto shrink-0 flex-col border-b border-white/5 bg-ink-950/70 backdrop-blur-xl md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-5 py-4 md:py-6">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-cyan text-lg shadow-[0_0_24px_-4px_rgb(139_92_246/0.8)]">
          🧪
        </div>
        <div>
          <div className="font-semibold leading-none tracking-tight">Agent Lab</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-400">estudo de agentes</div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
        {NAV.map(({ to, label, icon: Icon, highlight }) => (
          <NavLink key={to} to={to} className="relative shrink-0">
            {isActive(to) && (
              <motion.div layoutId="nav-active" className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.06]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <span className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] transition-colors ${isActive(to) ? "text-ink-100" : "text-ink-400 hover:text-ink-200"}`}>
              <Icon size={16} className={isActive(to) ? "text-cyan" : ""} />
              <span className="whitespace-nowrap">{label}</span>
              {highlight && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_var(--color-cyan)] md:block" />}
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto hidden space-y-2 p-3 md:block">
        <NavLink to="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-ink-400 transition hover:bg-white/5 hover:text-ink-200">
          <Settings size={16} /> Configurações
        </NavLink>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-2 text-[12px] text-ink-300">
            <LiveDot color={configured ? "bg-mint" : "bg-amber"} active={configured !== null} />
            {configured === null ? "Conectando…" : configured ? "Claude conectado" : "Modo demo (sem chave)"}
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-ink-500">
            <Activity size={10} /> API local :8787
          </div>
        </div>
      </div>
    </aside>
  );
}
