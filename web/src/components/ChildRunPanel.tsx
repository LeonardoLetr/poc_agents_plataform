import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Hand, Loader2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api, type Agent, type RunStatus } from "../lib/api";
import { fmtNumber, toolLabel } from "../lib/format";
import { useRunStream } from "../lib/hooks";
import { childActivity } from "../lib/runState";
import { OpenRunContext } from "./openRun";
import { Timeline } from "./Timeline";
import { Badge, Button } from "./ui";

const STATUS: Record<RunStatus | "idle", { text: string; color: "warn" | "ok" | "bad" | "ink" }> = {
  idle: { text: "Iniciando", color: "warn" },
  running: { text: "Executando", color: "warn" },
  awaiting_approval: { text: "Aguardando aprovação", color: "warn" },
  completed: { text: "Concluída", color: "ok" },
  failed: { text: "Falhou", color: "bad" },
  cancelled: { text: "Cancelada", color: "ink" },
};

/**
 * Painel lateral com uma execução delegada, ao vivo, sem sair da execução pai. `stack` é a cadeia aberta
 * (filha, neta…): abrir uma delegação de dentro do painel empilha, e "voltar" desempilha.
 */
export function ChildRunPanel({
  stack,
  agents,
  onOpen,
  onBack,
  onClose,
}: {
  stack: string[];
  agents: Agent[];
  onOpen: (runId: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const runId = stack.at(-1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!runId) return null;
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      aria-label="Execução delegada"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-ink-700 bg-surface shadow-[0_8px_24px_rgb(0_0_0/0.10)] sm:w-[480px] xl:w-[540px]"
    >
      <OpenRunContext.Provider value={onOpen}>
        <PanelRun key={runId} runId={runId} agents={agents} depth={stack.length} onBack={onBack} onClose={onClose} />
      </OpenRunContext.Provider>
    </motion.aside>
  );
}

function PanelRun({
  runId,
  agents,
  depth,
  onBack,
  onClose,
}: {
  runId: string;
  agents: Agent[];
  depth: number;
  onBack: () => void;
  onClose: () => void;
}) {
  const { view, run } = useRunStream(runId);
  const agent = agents.find((a) => a.id === run?.agentId);
  const status = STATUS[view.status];
  const activity = childActivity(view);
  const live = view.status === "running" || view.status === "awaiting_approval" || view.status === "idle";
  const tokens = view.tokens.input + view.tokens.output + view.childTokens.input + view.childTokens.output;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [view.steps, live]);

  return (
    <>
      <div className="border-b border-ink-700 px-4 py-3">
        <div className="flex items-center gap-2">
          {depth > 1 && (
            <Button size="sm" onClick={onBack} aria-label="Voltar para a execução anterior">
              <ArrowLeft size={14} />
            </Button>
          )}
          <span className="text-xl">{agent?.emoji ?? "🤖"}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-ink-100">{run?.agentName ?? agent?.name ?? "Execução delegada"}</div>
            <div className="text-[11px] text-ink-400">{depth > 1 ? `delegação de ${depth}º nível` : "execução delegada"}</div>
          </div>
          <Link to={`/playground/${runId}`} title="Abrir em tela cheia">
            <Button size="sm" variant="subtle">
              <ArrowUpRight size={14} /> <span className="hidden sm:inline">Tela cheia</span>
            </Button>
          </Link>
          <Button size="sm" onClick={onClose} aria-label="Fechar painel">
            <X size={15} />
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-400">
          <Badge color={status.color}>
            {live && <Loader2 size={10} className="animate-spin" />} {status.text}
          </Badge>
          {live && <span className={activity.busy ? "shimmer-text" : ""}>{activity.label}</span>}
          <span className="ml-auto tabular-nums">
            {view.iteration} it. · {fmtNumber(tokens)} tokens
          </span>
        </div>
        {run?.input && <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-300">{run.input}</p>}
      </div>

      {view.pendingApprovals.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-warn/30 bg-warn/[0.06] px-4 py-2.5 text-[12.5px]">
          <Hand size={14} className="text-warn" />
          <span className="min-w-0 flex-1 text-ink-200">
            Quer usar <b className="font-mono">{toolLabel(t.name).label}</b>
          </span>
          <Button size="sm" variant="danger" onClick={() => api.post(`/api/runs/${runId}/approve`, { toolUseId: t.id, approved: false })}>
            Negar
          </Button>
          <Button size="sm" variant="primary" onClick={() => api.post(`/api/runs/${runId}/approve`, { toolUseId: t.id, approved: true })}>
            Aprovar
          </Button>
        </div>
      ))}

      <div ref={scroller} className="flex-1 overflow-y-auto p-4">
        {view.steps.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-400">
            <Loader2 size={14} className="mr-2 animate-spin" /> Carregando a execução…
          </div>
        ) : (
          <Timeline steps={view.steps} live={live} />
        )}
      </div>
    </>
  );
}
