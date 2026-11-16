import { motion } from "motion/react";
import { ArrowUpRight, Columns3, Download, History, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, ErrorNote, PageHeader, Select, Textarea } from "../components/ui";
import { api, type Agent, type Comparison, type ComparisonSummary, type Llm, type RunEvent, type RunStatus } from "../lib/api";
import { fmtMs, fmtNumber, fmtUsd, timeAgo } from "../lib/format";
import { useEventStream, useInterval, useResource } from "../lib/hooks";
import { emptyRun, reduceRun } from "../lib/runState";

/**
 * Comparação lado a lado: a mesma tarefa executada em paralelo em 2 a 4 combinações de agente e LLM,
 * com progresso ao vivo e tabela de métricas.
 */
type Entry = { agentId: string; llmId: string }; // llmId "" = LLM configurada no agente

const STATUS: Record<RunStatus, { label: string; color: "ok" | "warn" | "bad" | "ink" }> = {
  running: { label: "Executando", color: "warn" },
  awaiting_approval: { label: "Aguardando aprovação", color: "warn" },
  completed: { label: "Concluída", color: "ok" },
  failed: { label: "Falhou", color: "bad" },
  cancelled: { label: "Cancelada", color: "ink" },
};

export default function Compare() {
  const { compareId } = useParams();
  const navigate = useNavigate();
  const agents = useResource<Agent[]>("/api/agents");
  const llms = useResource<Llm[]>("/api/llms");
  const history = useResource<ComparisonSummary[]>("/api/compare");
  const [input, setInput] = useState("Quanto é (1250 * 1.08) ^ 2 e que horas são agora?");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Comparison | null>(null);

  // Duas combinações iniciais: os dois primeiros agentes, cada um com a própria LLM.
  // Sem chaves configuradas, a segunda combinação usa a LLM demo para a comparação funcionar de imediato.
  useEffect(() => {
    const demo = agents.data?.find((a) => a.llmId === "llm_demo") ?? agents.data?.[0];
    if (entries.length || !agents.data || !demo || !llms.data) return;
    const other =
      agents.data.find((a) => a.id !== demo.id && a.tools.some((t) => t.startsWith("mcp__"))) ??
      agents.data.find((a) => a.id !== demo.id) ??
      demo;
    const otherReady = llms.data.find((l) => l.id === other.llmId)?.ready;
    setEntries([
      { agentId: demo.id, llmId: "" },
      { agentId: other.id, llmId: otherReady ? "" : (llms.data.find((l) => l.provider === "demo")?.id ?? "") },
    ]);
  }, [agents.data, llms.data, entries.length]);

  const load = async () => {
    if (!compareId) return setData(null);
    try {
      setData(await api.get<Comparison>(`/api/compare/${compareId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareId]);
  useInterval(load, compareId && !data?.done ? 1200 : null);

  async function start() {
    setError(null);
    try {
      const res = await api.post<{ id: string }>("/api/compare", {
        input: input.trim(),
        entries: entries.map((e) => ({ agentId: e.agentId, ...(e.llmId ? { llmId: e.llmId } : {}) })),
      });
      void history.reload();
      navigate(`/compare/${res.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function exportJson() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `comparacao-${data.id}.json` }).click();
    URL.revokeObjectURL(url);
  }

  const agentOf = (id: string) => agents.data?.find((a) => a.id === id);
  const llmOf = (id?: string) => llms.data?.find((l) => l.id === id);
  const running = Boolean(compareId && data && !data.done);

  return (
    <div>
      <PageHeader
        title="Comparar"
        description="Execute a mesma tarefa em paralelo em até 4 combinações de agente e LLM e compare tokens, custo, duração e respostas"
        actions={<RecentComparisons items={history.data ?? []} current={compareId} />}
      />

      <Card className="mb-5 p-4">
        <Textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tarefa a ser executada por todas as combinações"
          className="resize-none"
        />
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {entries.map((entry, i) => {
            const agent = agentOf(entry.agentId);
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-2">
                <span className="w-5 text-center text-[11px] font-medium tabular-nums text-ink-400">{i + 1}</span>
                <Select
                  value={entry.agentId}
                  onChange={(e) => setEntries(entries.map((x, j) => (j === i ? { ...x, agentId: e.target.value } : x)))}
                  className="min-w-0 flex-1"
                >
                  {agents.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.emoji} {a.name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={entry.llmId}
                  onChange={(e) => setEntries(entries.map((x, j) => (j === i ? { ...x, llmId: e.target.value } : x)))}
                  className="min-w-0 flex-1"
                >
                  <option value="">LLM do agente ({llmOf(agent?.llmId)?.name ?? "—"})</option>
                  {llms.data?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.ready ? "" : " · sem chave"}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={entries.length <= 2}
                  onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                  aria-label="Remover combinação"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={entries.length >= 4}
            onClick={() => setEntries([...entries, { agentId: entries[0]?.agentId ?? "", llmId: "" }])}
          >
            <Plus size={13} /> Combinação
          </Button>
          <span className="text-[12px] text-ink-400">{entries.length} de 4</span>
          <Button variant="primary" className="ml-auto" onClick={start} disabled={!input.trim() || entries.length < 2 || running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Columns3 size={14} />} Comparar
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      </Card>

      {data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-semibold text-ink-100">Resultados</span>
            <span className="min-w-0 truncate text-[12px] text-ink-400">“{data.input}”</span>
            <Button size="sm" className="ml-auto" onClick={exportJson} disabled={!data.done}>
              <Download size={13} /> Exportar JSON
            </Button>
          </div>
          <div className={`grid gap-3 md:grid-cols-2 ${data.results.length > 2 ? "xl:grid-cols-4" : ""}`}>
            {data.results.map((r, i) => (
              <LiveRunCard key={r.runId} index={i + 1} result={r} />
            ))}
          </div>
          {data.done && <MetricsTable data={data} />}
        </>
      )}
    </div>
  );
}

/** Cartão de uma combinação, com progresso ao vivo pelo stream da execução. */
function LiveRunCard({ index, result }: { index: number; result: Comparison["results"][number] }) {
  const [view, dispatch] = useReducer(
    (s: typeof emptyRun, e: RunEvent | { type: "snapshot"; events: RunEvent[] }) =>
      e.type === "snapshot" ? (e as { events: RunEvent[] }).events.reduce(reduceRun, emptyRun) : reduceRun(s, e as RunEvent),
    emptyRun,
  );
  useEventStream<RunEvent | { type: "snapshot"; events: RunEvent[] }>(`/api/runs/${result.runId}/stream`, dispatch);
  const status = STATUS[view.status === "idle" ? result.status : view.status];
  const final = [...view.steps].reverse().find((s) => s.kind === "final" || s.kind === "error");
  const tools = Object.values(view.callCounts).reduce((a, b) => a + b, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col rounded-xl border border-ink-700 bg-surface p-3"
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-400">
        Combinação {index}
        <span className="ml-auto normal-case tracking-normal">
          <Badge color={status.color}>
            {status.color === "warn" && <Loader2 size={10} className="animate-spin" />} {status.label}
          </Badge>
        </span>
      </div>
      <div className="mt-2 truncate text-[13px] font-medium text-ink-100">{result.agentName}</div>
      <div className="truncate text-[12px] text-ink-400">
        {result.llmName} · {result.model}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-y border-ink-850 py-2 text-center">
        {[
          ["Iterações", view.iteration],
          ["Tokens", view.tokens.input + view.tokens.output],
          ["Ferramentas", tools],
        ].map(([label, value]) => (
          <div key={label as string}>
            <div className="text-[15px] font-semibold tabular-nums text-ink-100">{fmtNumber(value as number)}</div>
            <div className="text-[10.5px] text-ink-400">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 max-h-48 min-h-[60px] flex-1 overflow-y-auto text-[12.5px]">
        {final ? (
          final.kind === "error" ? (
            <p className="text-bad">{final.text}</p>
          ) : (
            <Markdown text={final.text} className="!text-[12.5px]" />
          )
        ) : (
          <p className="text-ink-400">Aguardando resposta…</p>
        )}
      </div>
      <Link
        to={`/playground/${result.runId}`}
        className="mt-2 inline-flex items-center gap-1 self-start text-[12px] text-accent hover:underline"
      >
        Ver execução completa <ArrowUpRight size={12} />
      </Link>
    </motion.div>
  );
}

/** Tabela comparativa; destaca o menor valor de cada métrica entre as execuções concluídas. */
function MetricsTable({ data }: { data: Comparison }) {
  const ok = data.results.filter((r) => r.status === "completed");
  const rows = useMemo(
    () =>
      [
        { label: "Iterações", get: (r: Comparison["results"][number]) => r.iterations, fmt: (v: number | null) => fmtNumber(v ?? 0) },
        {
          label: "Tokens de entrada",
          get: (r: Comparison["results"][number]) => r.tokens.input,
          fmt: (v: number | null) => fmtNumber(v ?? 0),
        },
        {
          label: "Tokens de saída",
          get: (r: Comparison["results"][number]) => r.tokens.output,
          fmt: (v: number | null) => fmtNumber(v ?? 0),
        },
        {
          label: "Tokens no total",
          get: (r: Comparison["results"][number]) => r.tokens.total,
          fmt: (v: number | null) => fmtNumber(v ?? 0),
        },
        {
          label: "Custo estimado",
          get: (r: Comparison["results"][number]) => r.costUsd,
          fmt: (v: number | null) => (v === null ? "não estimado" : fmtUsd(v)),
        },
        {
          label: "Duração",
          get: (r: Comparison["results"][number]) => r.durationMs,
          fmt: (v: number | null) => (v === null ? "—" : fmtMs(v)),
        },
        {
          label: "Chamadas de ferramenta",
          get: (r: Comparison["results"][number]) => r.toolCalls,
          fmt: (v: number | null) => fmtNumber(v ?? 0),
        },
      ] as const,
    [],
  );
  const best = (get: (r: Comparison["results"][number]) => number | null) => {
    const values = ok.map(get).filter((v): v is number => v !== null);
    return values.length > 1 ? Math.min(...values) : null;
  };

  return (
    <Card className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead>
          <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-[0.04em] text-ink-400">
            <th className="px-4 py-2.5 font-medium">Métrica</th>
            {data.results.map((r, i) => (
              <th key={r.runId} className="px-4 py-2.5 font-medium normal-case tracking-normal">
                <span className="text-ink-400">{i + 1}.</span> <span className="text-ink-100">{r.agentName}</span>
                <div className="truncate text-[11px] font-normal text-ink-400">{r.llmName}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-ink-850">
            <td className="px-4 py-2 text-ink-400">Status</td>
            {data.results.map((r) => (
              <td key={r.runId} className="px-4 py-2">
                <Badge color={STATUS[r.status]?.color ?? "ink"}>{STATUS[r.status]?.label ?? r.status}</Badge>
              </td>
            ))}
          </tr>
          {rows.map((row) => {
            const min = best(row.get);
            return (
              <tr key={row.label} className="border-b border-ink-850 last:border-0">
                <td className="px-4 py-2 text-ink-400">{row.label}</td>
                {data.results.map((r) => {
                  const v = row.get(r);
                  const isBest = min !== null && r.status === "completed" && v === min;
                  return (
                    <td key={r.runId} className={`px-4 py-2 tabular-nums ${isBest ? "font-semibold text-ok" : "text-ink-200"}`}>
                      {row.fmt(v)} {isBest && <span className="text-[10.5px] font-normal">· menor</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr>
            <td className="px-4 py-2 text-ink-400">Ferramentas usadas</td>
            {data.results.map((r) => (
              <td key={r.runId} className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                  {r.tools.length ? (
                    r.tools.map((t) => <Badge key={t}>{t.replace(/^mcp__(.+?)__/, "$1/")}</Badge>)
                  ) : (
                    <span className="text-ink-400">nenhuma</span>
                  )}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function RecentComparisons({ items, current }: { items: ComparisonSummary[]; current?: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen(!open)}>
        <History size={13} /> Comparações recentes
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 max-h-80 w-72 overflow-y-auto rounded-lg border border-ink-700 bg-surface p-1 shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
          {items.length === 0 && <div className="p-3 text-[12px] text-ink-400">Nenhuma comparação ainda.</div>}
          {items.map((c) => (
            <Link
              key={c.id}
              to={`/compare/${c.id}`}
              onClick={() => setOpen(false)}
              className={`block rounded-md px-2.5 py-2 hover:bg-ink-850 ${c.id === current ? "bg-ink-850" : ""}`}
            >
              <div className="truncate text-[12.5px] text-ink-100">{c.input}</div>
              <div className="text-[11px] text-ink-400">
                {c.count} combinações · {timeAgo(c.startedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
