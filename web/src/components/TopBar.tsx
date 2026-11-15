import { ChevronRight, FlaskConical, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const PAGES = [
  { to: "/", label: "Visão geral" },
  { to: "/playground", label: "Playground" },
  { to: "/agents", label: "Agentes" },
  { to: "/llms", label: "LLMs" },
  { to: "/mcp", label: "Servidores MCP" },
  { to: "/prompts", label: "Prompts" },
  { to: "/memory", label: "Memória" },
  { to: "/audit", label: "Auditoria" },
  { to: "/learn", label: "Aprender" },
];

/** Barra superior: breadcrumb, busca de páginas (⌘K) e a ação principal da tela inicial. */
export function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = PAGES.find((p) => (p.to === "/" ? pathname === "/" : pathname.startsWith(p.to)));
  const results = useMemo(() => PAGES.filter((p) => p.label.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    navigate(to);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-ink-700 bg-white px-4 md:px-6">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <FlaskConical size={14} className="shrink-0 text-ink-400" />
        <Link to="/" className="hidden text-ink-400 hover:text-ink-200 sm:inline">
          Agent Lab
        </Link>
        <ChevronRight size={13} className="hidden shrink-0 text-ink-500 sm:block" />
        <span className="truncate font-medium text-ink-100">{current?.label ?? "Agent Lab"}</span>
      </nav>

      <div className="relative ml-auto hidden md:block">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0].to);
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder="Ir para…"
          className="h-8 w-64 rounded-lg border border-ink-700 bg-ink-900 pl-8 pr-10 text-[13px] text-ink-100 outline-none transition placeholder:text-ink-500 focus:border-accent focus:bg-white focus:ring-[3px] focus:ring-[#dbeafe]"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-ink-700 bg-white px-1 text-[10px] font-medium text-ink-400">⌘K</kbd>
        {open && results.length > 0 && (
          <div className="absolute right-0 top-10 w-64 rounded-lg border border-ink-700 bg-white p-1 shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
            {results.map((p) => (
              <button key={p.to} onMouseDown={() => go(p.to)} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] text-ink-200 hover:bg-ink-850">
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {pathname === "/" && (
        <Link to="/playground" className="ml-auto shrink-0 md:ml-0">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#1d4ed8]">
            <Plus size={14} /> Nova execução
          </span>
        </Link>
      )}
    </header>
  );
}
