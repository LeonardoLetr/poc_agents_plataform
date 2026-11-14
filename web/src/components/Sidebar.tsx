import { motion } from "motion/react";
import { BookOpen, Bot, Brain, Cpu, FileText, Globe, LayoutDashboard, Plug, Play, Server, ShieldCheck, Trash2 } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { Health } from "../lib/api";
import { resetBrowserData } from "../lib/runtime";
import { LiveDot } from "./effects";

const NAV = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/playground", label: "Playground", icon: Play, highlight: true },
  { to: "/agents", label: "Agentes", icon: Bot },
  { to: "/llms", label: "LLMs", icon: Cpu },
  { to: "/mcp", label: "Servidores MCP", icon: Plug },
  { to: "/memory", label: "Memória", icon: Brain },
  { to: "/prompts", label: "Prompts", icon: FileText },
  { to: "/audit", label: "Auditoria", icon: ShieldCheck },
  { to: "/learn", label: "Aprender", icon: BookOpen },
];

export function Sidebar({ health }: { health: Health | null }) {
  const { pathname } = useLocation();
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  return (
    <aside className="sticky top-0 z-20 flex h-auto shrink-0 flex-col border-b border-black/[0.07] bg-ink-900 md:h-screen md:w-56 md:border-r md:border-b-0">
      <div className="flex items-center gap-2.5 px-5 py-4 md:pb-6 md:pt-5">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-accent">
          <path fill="currentColor" d="M9 2h6v2h-1v5.2l5.6 9.3A2.3 2.3 0 0 1 17.6 22H6.4a2.3 2.3 0 0 1-2-3.5L10 9.2V4H9V2Zm3 9.3L8.3 17.5h7.4L12 11.3Z" />
        </svg>
        <div className="font-serif text-[19px] leading-none tracking-[-0.01em] text-ink-100">Agent Lab</div>
      </div>

      <nav className="flex gap-0.5 overflow-x-auto px-2.5 pb-3 md:flex-col md:overflow-visible md:pb-0">
        {NAV.map(({ to, label, icon: Icon, highlight }) => (
          <NavLink key={to} to={to} className="relative shrink-0">
            {isActive(to) && (
              <motion.div layoutId="nav-active" className="absolute inset-0 rounded-lg bg-black/[0.06]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            )}
            <span className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors ${isActive(to) ? "font-medium text-ink-100" : "text-ink-300 hover:text-ink-100"}`}>
              <Icon size={15} strokeWidth={1.8} className={isActive(to) ? "text-ink-100" : "text-ink-400"} />
              <span className="whitespace-nowrap">{label}</span>
              {highlight && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-accent md:block" />}
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto hidden space-y-2 p-3 md:block">
        <div className="rounded-lg border border-black/[0.07] bg-white/60 p-3">
          <div className="flex items-center gap-2 text-[12px] text-ink-300">
            <LiveDot color={health?.llmsReady ? "bg-ok" : "bg-warn"} active={health !== null} />
            {health === null ? "Conectando…" : `${health.llmsReady}/${health.llmsTotal} LLMs prontas`}
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-ink-500">
            {health?.runtime === "browser" ? <Globe size={10} /> : <Server size={10} />}
            {health?.runtime === "browser" ? "modo navegador · dados locais" : "servidor local :8787"}
          </div>
          {health?.runtime === "browser" && (
            <button
              onClick={() => confirm("Apagar todos os dados salvos neste navegador (agentes, LLMs, chaves, memórias)?") && resetBrowserData()}
              className="mt-2 flex items-center gap-1 text-[10.5px] text-ink-500 transition hover:text-bad"
            >
              <Trash2 size={10} /> apagar dados locais
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
