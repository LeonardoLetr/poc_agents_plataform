import { motion } from "motion/react";
import {
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  Columns3,
  Cpu,
  FileText,
  Download,
  Globe,
  LayoutDashboard,
  Play,
  Plug,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { Health, Stats } from "../lib/api";
import { useInterval, useResource } from "../lib/hooks";
import { resetBrowserData } from "../lib/runtime";
import { downloadExport, ImportDialog } from "./BackupDialog";

type Item = { to: string; label: string; icon: typeof Bot; count?: (s: Stats) => number | string; dot?: (s: Stats) => boolean };

/** Navegação agrupada, como em painéis SaaS: itens principais, grupos recolhíveis e rodapé. */
const MAIN: Item[] = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/playground", label: "Playground", icon: Play },
  { to: "/compare", label: "Comparar", icon: Columns3 },
];
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Construir",
    items: [
      { to: "/agents", label: "Agentes", icon: Bot, count: (s) => s.agents },
      { to: "/llms", label: "LLMs", icon: Cpu, count: (s) => s.llms },
      { to: "/mcp", label: "Servidores MCP", icon: Plug, count: (s) => `${s.mcpConnected}/${s.mcpServers}` },
      { to: "/prompts", label: "Prompts", icon: FileText },
    ],
  },
  {
    title: "Observar",
    items: [
      { to: "/memory", label: "Memória", icon: Brain, count: (s) => s.memories },
      { to: "/audit", label: "Auditoria", icon: ShieldCheck, dot: (s) => (s.runsByStatus.failed ?? 0) > 0 },
    ],
  },
];

export function Sidebar({ health }: { health: Health | null }) {
  const { pathname } = useLocation();
  const stats = useResource<Stats>("/api/stats");
  useInterval(stats.reload, 10_000);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  const link = ({ to, label, icon: Icon, count, dot }: Item) => (
    <NavLink key={to} to={to} className="relative shrink-0">
      {isActive(to) && (
        <motion.div
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-ink-850"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <span
        className={`relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${isActive(to) ? "font-medium text-ink-100" : "text-ink-300 hover:bg-ink-850/60 hover:text-ink-100"}`}
      >
        <Icon size={16} strokeWidth={1.6} className={isActive(to) ? "text-ink-100" : "text-ink-400"} />
        <span className="whitespace-nowrap">{label}</span>
        {stats.data && dot?.(stats.data) && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-bad md:block" />}
        {stats.data && count && <span className="ml-auto hidden text-[12px] tabular-nums text-ink-500 md:block">{count(stats.data)}</span>}
      </span>
    </NavLink>
  );

  return (
    <aside className="sticky top-0 z-20 flex h-auto shrink-0 flex-col border-b border-ink-700 bg-ink-900 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center gap-2 px-4 py-3.5 md:pb-4">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="text-ink-100">
          <path
            fill="currentColor"
            d="M9 2h6v2h-1v5.2l5.6 9.3A2.3 2.3 0 0 1 17.6 22H6.4a2.3 2.3 0 0 1-2-3.5L10 9.2V4H9V2Zm3 9.3L8.3 17.5h7.4L12 11.3Z"
          />
        </svg>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink-100">Agent Lab</span>
      </div>

      <nav className="flex gap-0.5 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
        {MAIN.map(link)}
        {GROUPS.map((g) => (
          <div key={g.title} className="contents md:block md:pt-4">
            <button
              onClick={() => setClosed((c) => ({ ...c, [g.title]: !c[g.title] }))}
              className="hidden w-full items-center gap-1 px-2.5 pb-1 text-[12px] text-ink-400 hover:text-ink-200 md:flex"
            >
              {g.title}
              <ChevronDown size={12} className={`transition ${closed[g.title] ? "-rotate-90" : ""}`} />
            </button>
            <div className={`contents md:flex md:flex-col md:gap-0.5 ${closed[g.title] ? "md:hidden" : ""}`}>{g.items.map(link)}</div>
          </div>
        ))}
      </nav>

      <div className="mt-auto hidden space-y-0.5 p-3 md:block">
        {link({ to: "/learn", label: "Aprender", icon: BookOpen })}
        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-ink-700 bg-surface p-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-950">
            <Globe size={15} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-ink-100">Dados neste navegador</div>
            <div className="truncate text-[11px] text-ink-400">
              {health ? `${health.llmsReady}/${health.llmsTotal} LLMs prontas` : "Conectando…"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-[11px] text-ink-400">
          <button
            onClick={() => void downloadExport()}
            className="flex items-center gap-1 transition hover:text-ink-100"
            title="Baixa agentes, LLMs (sem chaves), prompts, servidores MCP e memórias em JSON"
          >
            <Download size={11} /> Exportar
          </button>
          <button onClick={() => setImporting(true)} className="flex items-center gap-1 transition hover:text-ink-100">
            <Upload size={11} /> Importar
          </button>
          <button
            onClick={() => confirm("Apagar todos os dados salvos neste navegador (agentes, LLMs, chaves, memórias)?") && resetBrowserData()}
            className="flex items-center gap-1 transition hover:text-bad"
          >
            <Trash2 size={11} /> Apagar dados
          </button>
        </div>
        <ImportDialog open={importing} onClose={() => setImporting(false)} />
      </div>
    </aside>
  );
}
