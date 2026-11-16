import { AnimatePresence, motion } from "motion/react";
import { Bot, Brain, ChevronRight, Cpu, Download, Pause, Play, Plug, Settings2, ShieldCheck, User, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LiveDot } from "../components/effects";
import { JsonView } from "../components/JsonView";
import { Badge, Button, Card, Input, PageHeader, Select } from "../components/ui";
import { api, type Agent, type AuditEntry } from "../lib/api";
import { fmtDateTime, fmtMs, fmtNumber, fmtTime } from "../lib/format";
import { useEventStream, useResource } from "../lib/hooks";

const GROUPS = [
  { id: "", label: "Tudo" },
  { id: "run", label: "Execuções" },
  { id: "llm", label: "LLM" },
  { id: "tool", label: "Ferramentas" },
  { id: "memory", label: "Memória" },
  { id: "mcp", label: "MCP" },
  { id: "config", label: "Configuração" },
];

const CONFIG_STYLE = { icon: Settings2, color: "#9a9abd" };
const TYPE_STYLE: Record<string, { icon: typeof Bot; color: string }> = {
  run: { icon: Play, color: "#0284c7" },
  llm: { icon: Cpu, color: "#2563eb" },
  tool: { icon: Wrench, color: "#d97706" },
  memory: { icon: Brain, color: "#7c3aed" },
  mcp: { icon: Plug, color: "#ea580c" },
  config: CONFIG_STYLE,
};

export default function Audit() {
  const [params] = useSearchParams();
  const [group, setGroup] = useState("");
  const [agentId, setAgentId] = useState("");
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const runId = params.get("runId") ?? "";
  const agents = useResource<Agent[]>("/api/agents");

  const query = useMemo(() => new URLSearchParams({ type: group, agentId, q, runId, limit: "400" }).toString(), [group, agentId, q, runId]);

  useEffect(() => {
    void api.get<{ total: number; entries: AuditEntry[] }>(`/api/audit?${query}`).then((r) => {
      setEntries(r.entries);
      setTotal(r.total);
    });
  }, [query]);

  const live = useEventStream<AuditEntry>(paused ? null : "/api/audit/stream", (e) => {
    const matches = (!group || e.type.startsWith(group)) && (!agentId || e.agentId === agentId) && (!runId || e.runId === runId) && (!q || e.summary.toLowerCase().includes(q.toLowerCase()));
    if (!matches) return;
    setEntries((list) => [e, ...list].slice(0, 400));
    setTotal((t) => t + 1);
  });

  const totals = useMemo(() => {
    let input = 0, output = 0, cache = 0, tools = 0, errors = 0;
    for (const e of entries) {
      if (e.type === "llm.response" && e.tokens) {
        input += e.tokens.input;
        output += e.tokens.output;
        cache += e.tokens.cacheRead ?? 0;
      }
      if (e.type === "tool.call") tools++;
      if (e.type === "run.failed" || e.type === "mcp.error" || (e.type === "tool.result" && (e.data as { isError?: boolean })?.isError)) errors++;
    }
    return { input, output, cache, tools, errors };
  }, [entries]);

  const agentName = (id?: string) => agents.data?.find((a) => a.id === id)?.name;

  return (
    <div>
      <PageHeader
        eyebrow="governança"
        title="Trilha de auditoria"
        description="Cada decisão do LLM, chamada de ferramenta, acesso à memória e mudança de configuração fica registrada — com quem fez, quando, quanto custou e quanto demorou."
        actions={
          <>
            <Button onClick={() => setPaused(!paused)}>
              {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? "Retomar" : "Pausar"} ao vivo
            </Button>
            <Button
              onClick={async () => {
                // Funciona nos dois modos: busca os dados e gera o arquivo no próprio navegador.
                const data = await api.get(`/api/audit/export?${query}`);
                const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
                const a = Object.assign(document.createElement("a"), { href: url, download: `auditoria-${Date.now()}.json` });
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={14} /> Exportar JSON
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Eventos", total],
          ["Tokens entrada", totals.input],
          ["Tokens saída", totals.output],
          ["Tokens do cache", totals.cache],
          ["Erros", totals.errors],
        ].map(([label, value]) => (
          <Card key={label as string} className="p-3.5">
            <div className="text-[11px] text-ink-400">{label}</div>
            <div className={`mt-1 text-xl font-medium tracking-tight tabular-nums text-ink-100 ${label === "Erros" && Number(value) > 0 ? "text-bad" : ""}`}>{fmtNumber(Number(value))}</div>
          </Card>
        ))}
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-2">
        <div className="flex gap-1 overflow-x-auto">
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => setGroup(g.id)} className="relative rounded-lg px-3 py-1.5 text-[12.5px]">
              {group === g.id && <motion.div layoutId="audit-group" className="absolute inset-0 rounded-lg bg-ink-850" />}
              <span className={`relative ${group === g.id ? "text-ink-100" : "text-ink-400"}`}>{g.label}</span>
            </button>
          ))}
        </div>
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="!h-8 !w-48 text-xs">
          <option value="">Todos os agentes</option>
          {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar no resumo…" className="!h-8 !w-56 text-xs" />
        {runId && <Badge color="info">execução {runId}</Badge>}
        <span className="ml-auto flex items-center gap-2 pr-2 text-[11.5px] text-ink-400">
          <LiveDot active={live && !paused} /> {paused ? "pausado" : live ? "ao vivo" : "reconectando"}
        </span>
      </Card>

      <Card className="overflow-hidden">
        {entries.length === 0 && <div className="flex flex-col items-center p-12 text-ink-400"><ShieldCheck className="mb-2" /> Nenhum evento para estes filtros.</div>}
        <AnimatePresence initial={false}>
          {entries.map((e) => {
            const style = TYPE_STYLE[e.type.split(".")[0] ?? ""] ?? CONFIG_STYLE;
            const Icon = style.icon;
            const open = openId === e.id;
            return (
              <motion.div key={e.id} layout="position" initial={{ opacity: 0, backgroundColor: "rgba(139,92,246,0.15)" }} animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 1.2 }} className="border-b border-ink-700 last:border-0">
                <button onClick={() => setOpenId(open ? null : e.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-900">
                  <ChevronRight size={13} className={`shrink-0 text-ink-500 transition ${open ? "rotate-90" : ""}`} />
                  <span className="w-[68px] shrink-0 font-mono text-[11px] text-ink-500">{fmtTime(e.ts)}</span>
                  <span className="flex w-[150px] shrink-0 items-center gap-1.5 font-mono text-[11px]" style={{ color: style.color }}>
                    <Icon size={12} /> {e.type}
                  </span>
                  <span className="flex w-[70px] shrink-0 items-center gap-1 text-[11px] text-ink-400">
                    {e.actor === "user" ? <User size={11} /> : e.actor === "agent" ? <Bot size={11} /> : <Settings2 size={11} />}
                    {e.actor === "user" ? "usuário" : e.actor === "agent" ? "agente" : "sistema"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">{e.summary}</span>
                  {agentName(e.agentId) && <Badge className="hidden md:inline-flex">{agentName(e.agentId)}</Badge>}
                  {e.tokens && <span className="hidden font-mono text-[10.5px] text-ink-500 md:inline">↑{fmtNumber(e.tokens.input)} ↓{fmtNumber(e.tokens.output)}</span>}
                  {e.durationMs !== undefined && <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-ink-500">{fmtMs(e.durationMs)}</span>}
                </button>
                <AnimatePresence>
                  {open && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="grid gap-3 px-11 pb-4 md:grid-cols-[220px_1fr]">
                        <div className="space-y-1 font-mono text-[11px] text-ink-400">
                          <div>id: {e.id}</div>
                          <div>quando: {fmtDateTime(e.ts)}</div>
                          {e.runId && <div>execução: <Link className="text-info" to={`/playground/${e.runId}`}>{e.runId}</Link></div>}
                          {e.agentId && <div>agente: {agentName(e.agentId) ?? e.agentId}</div>}
                        </div>
                        {e.data !== undefined ? <JsonView value={e.data} maxHeight={300} /> : <div className="text-[12px] text-ink-500">Sem dados adicionais.</div>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Card>
    </div>
  );
}
