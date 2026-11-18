import { motion } from "motion/react";
import { Activity, ArrowUpRight, Bot, Calendar, Coins, Cpu, Plus, Repeat, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BarSpark, DotHistogram, KpiCard, Progress } from "../components/kpi";
import { Badge, PageHeader } from "../components/ui";
import type { Agent, AuditEntry, Health, Llm, RunSummary, Stats } from "../lib/api";
import { fmtNumber, fmtTime, fmtUsd } from "../lib/format";
import { useEventStream, useInterval, useResource } from "../lib/hooks";

type Tab = "agents" | "activity" | "tools";

const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: "agents", label: "Agentes", icon: Bot },
  { id: "activity", label: "Atividade", icon: Activity },
  { id: "tools", label: "Ferramentas", icon: Wrench },
];

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "Compatível OpenAI", demo: "Demo" };

export default function Dashboard({ health }: { health: Health | null }) {
  const stats = useResource<Stats>("/api/stats");
  const agents = useResource<Agent[]>("/api/agents");
  const llms = useResource<Llm[]>("/api/llms");
  const runs = useResource<RunSummary[]>("/api/runs");
  const recent = useResource<{ entries: AuditEntry[] }>("/api/audit?limit=14");
  const [feed, setFeed] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<Tab>("agents");
  useInterval(() => {
    void stats.reload();
    void runs.reload();
  }, 8000);
  useEventStream<AuditEntry>("/api/audit/stream", (e) => setFeed((f) => [e, ...f].slice(0, 14)));

  const s = stats.data;
  const activity = [...feed, ...(recent.data?.entries ?? [])].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i).slice(0, 14);
  const toolUsage = Object.entries(s?.toolUsage ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxUse = Math.max(1, ...toolUsage.map((t) => t[1]));
  const history = [...(runs.data ?? [])].reverse().slice(-40);
  const completed = s?.runsByStatus.completed ?? 0;
  const failed = s?.runsByStatus.failed ?? 0;
  const donePct = s?.runs ? Math.round((completed / s.runs) * 100) : 0;
  const llmOf = (a: Agent) => llms.data?.find((l) => l.id === a.llmId);

  return (
    <div>
      <PageHeader
        title="Visão geral do laboratório"
        description="Execuções, consumo de tokens e configuração dos agentes"
        actions={
          <div className="flex items-center">
            {agents.data?.slice(0, 4).map((a, i) => (
              <span
                key={a.id}
                className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface text-[12px] first:ml-0"
                style={{ background: `${a.color}22`, zIndex: 10 - i }}
                title={a.name}
              >
                {a.emoji}
              </span>
            ))}
            {(agents.data?.length ?? 0) > 4 && (
              <span className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-ink-850 text-[10px] font-medium text-ink-400">
                +{agents.data!.length - 4}
              </span>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <section className="grid gap-3 md:grid-cols-3">
        <KpiCard
          icon={<Repeat size={11} />}
          iconColor="#f97316"
          label="Execuções"
          value={fmtNumber(s?.runs ?? 0)}
          caption={failed ? `${failed} com falha` : "Nenhuma falha registrada"}
          aside={s?.runs ? <Badge color="ok">{donePct}% concluídas</Badge> : undefined}
        >
          <DotHistogram values={history.map((r) => r.iterations)} />
        </KpiCard>
        <KpiCard
          icon={<Coins size={11} />}
          iconColor="#3b82f6"
          label="Tokens processados"
          value={fmtNumber((s?.tokens.input ?? 0) + (s?.tokens.output ?? 0))}
          caption={
            <>
              <span className="text-ink-200">{fmtNumber(s?.tokens.input ?? 0)}</span> de entrada ·{" "}
              <span className="text-ink-200">{fmtNumber(s?.tokens.output ?? 0)}</span> de saída
            </>
          }
          aside={
            <span
              className="text-[11px] text-ink-400"
              title={s?.unpricedRuns ? `${s.unpricedRuns} execuções sem preço conhecido ficaram fora da estimativa` : undefined}
            >
              {fmtUsd(s?.estimatedCostUsd ?? 0)}
              {s?.unpricedRuns ? ` + ${s.unpricedRuns} não estimadas` : ""}
            </span>
          }
        >
          <BarSpark values={history.map((r) => r.usage.input + r.usage.output)} />
        </KpiCard>
        <KpiCard
          icon={<Cpu size={11} />}
          iconColor="#16a34a"
          label="LLMs prontas"
          value={`${health?.llmsReady ?? 0}/${health?.llmsTotal ?? 0}`}
          caption={`${s?.mcpConnected ?? 0} de ${s?.mcpServers ?? 0} servidores MCP conectados`}
          aside={
            <Link
              to="/llms"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-ink-700 text-ink-400 hover:bg-ink-850 hover:text-ink-100"
              aria-label="Gerenciar LLMs"
            >
              <ArrowUpRight size={13} />
            </Link>
          }
        >
          <Progress value={health?.llmsTotal ? health.llmsReady / health.llmsTotal : 0} />
        </KpiCard>
      </section>

      {/* Abas */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-700 pt-4">
        <span className="text-[13px] font-semibold text-ink-100">Meu laboratório</span>
        <span className="hidden h-4 w-px bg-ink-700 sm:block" />
        <div className="flex flex-wrap gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors ${tab === id ? "bg-ink-850 font-medium text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
            >
              <Icon size={14} strokeWidth={1.7} /> {label}
            </button>
          ))}
        </div>
        <Link to="/audit" className="ml-auto">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ink-700 bg-surface px-2.5 text-[12px] font-medium text-ink-200 hover:bg-ink-900">
            <ShieldCheck size={13} /> Auditoria completa
          </span>
        </Link>
      </div>

      <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="mt-4">
        {tab === "agents" && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {agents.data?.map((a) => {
              const l = llmOf(a);
              return (
                <Link
                  key={a.id}
                  to="/playground"
                  className="group flex flex-col rounded-xl border border-ink-700 bg-surface p-3 transition-colors hover:border-ink-600"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-400">
                    <Cpu size={12} strokeWidth={1.7} /> {l ? PROVIDER_LABEL[l.provider] : "Sem LLM"}
                    <span className="ml-auto normal-case tracking-normal">
                      {l && <Badge color={l.ready ? "ok" : "warn"}>{l.ready ? "Pronta" : "Sem chave"}</Badge>}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="text-[16px]">{a.emoji}</span>
                    <span className="truncate text-[13px] font-medium text-ink-100">{a.name}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[32px] text-[12px] leading-snug text-ink-400">{a.description}</p>
                  <div className="mt-3 flex items-center gap-1.5 border-t border-ink-850 pt-2.5 text-[11px] text-ink-400">
                    <Wrench size={12} /> {a.tools.length} ferramentas
                    <span className="ml-auto truncate">{l?.name ?? "—"}</span>
                  </div>
                </Link>
              );
            })}
            <Link
              to="/agents"
              className="flex min-h-[130px] items-center justify-center rounded-xl border border-dashed border-ink-600 text-[12px] text-ink-400 transition-colors hover:border-ink-500 hover:text-ink-200"
            >
              <Plus size={13} className="mr-1" /> Novo agente
            </Link>
          </div>
        )}

        {tab === "activity" && (
          <div className="overflow-hidden rounded-xl border border-ink-700 bg-surface">
            {activity.length === 0 && (
              <p className="p-8 text-center text-[13px] text-ink-400">Nenhuma atividade ainda. Rode um agente no Playground.</p>
            )}
            {activity.map((e) => (
              <div key={e.id} className="flex items-center gap-3 border-b border-ink-850 px-4 py-2.5 last:border-0">
                <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] tabular-nums text-ink-400">
                  <Calendar size={11} /> {fmtTime(e.ts)}
                </span>
                <Badge
                  color={
                    e.type.startsWith("run.failed") || e.type === "mcp.error"
                      ? "bad"
                      : e.type.startsWith("tool")
                        ? "warn"
                        : e.type.startsWith("memory")
                          ? "memory"
                          : e.type.startsWith("llm")
                            ? "accent"
                            : "ink"
                  }
                >
                  {e.type}
                </Badge>
                <span className="min-w-0 truncate text-[13px] text-ink-200">{e.summary}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "tools" && (
          <div className="rounded-xl border border-ink-700 bg-surface p-4">
            {toolUsage.length === 0 && <p className="py-6 text-center text-[13px] text-ink-400">Nenhuma ferramenta chamada ainda.</p>}
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
              {toolUsage.map(([name, n]) => (
                <div key={name}>
                  <div className="mb-1.5 flex justify-between gap-2 text-[12px]">
                    <span className="truncate font-mono text-ink-200">{name}</span>
                    <span className="tabular-nums text-ink-400">{n}</span>
                  </div>
                  <Progress value={n / maxUse} color="#3b82f6" height={4} />
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
