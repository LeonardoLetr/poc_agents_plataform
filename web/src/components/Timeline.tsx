import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ArrowUpRight,
  Bot,
  CircleDashed,
  Cloud,
  Hand,
  Link2,
  Loader2,
  MessageSquare,
  Plug,
  Scissors,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { useReducer, useState } from "react";
import { Link } from "react-router-dom";
import { fmtMs, fmtNumber, kindLabel, toolLabel } from "../lib/format";
import type { Citation, RunEvent, RunStatus } from "../lib/api";
import { useEventStream } from "../lib/hooks";
import { emptyRun, reduceRun, type Step, type ToolStep } from "../lib/runState";
import { JsonView } from "./JsonView";
import { Markdown } from "./Markdown";
import { Badge } from "./ui";

const enter = {
  initial: { opacity: 0, y: 14, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: "spring" as const, stiffness: 300, damping: 28 },
};

function Rail({ icon, color, children, last }: { icon: React.ReactNode; color: string; children: React.ReactNode; last?: boolean }) {
  return (
    <motion.div {...enter} className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-700"
          style={{ background: `color-mix(in oklab, ${color} 18%, var(--color-surface))`, color }}
        >
          {icon}
        </div>
        {!last && <div className="w-px flex-1 bg-gradient-to-b from-ink-700 to-transparent" />}
      </div>
      <div className="min-w-0 flex-1 pb-5">{children}</div>
    </motion.div>
  );
}

function ToolCard({ tool }: { tool: ToolStep }) {
  const [open, setOpen] = useState(false);
  const { label: rawLabel, server } = toolLabel(tool.name);
  const isAgent = tool.source === "agent";
  const label = isAgent ? (tool.child?.agentName ?? "agente") : rawLabel;
  const status = {
    running: { icon: <Loader2 size={11} className="animate-spin" />, badge: "warn" as const, text: "Executando" },
    awaiting_approval: { icon: <Hand size={11} />, badge: "warn" as const, text: "Aguardando aprovação" },
    done: { icon: <CheckCircle2 size={11} />, badge: "ok" as const, text: "Concluída" },
    error: { icon: <XCircle size={11} />, badge: "bad" as const, text: "Erro" },
    denied: { icon: <XCircle size={11} />, badge: "bad" as const, text: "Negada" },
  }[tool.status];
  return (
    <motion.div
      layout
      {...enter}
      className={`overflow-hidden rounded-[10px] border bg-surface ${tool.status === "running" ? "beam [--beam-color:var(--color-warn)]" : "border-ink-700"}`}
    >
      {/* Cartão de item: categoria em caixa alta + status, nome, rodapé com duração */}
      <button onClick={() => setOpen(!open)} className="block w-full p-3 text-left">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-400">
          {server ? (
            <Plug size={11} />
          ) : tool.source === "server" ? (
            <Cloud size={11} />
          ) : isAgent ? (
            <Bot size={11} />
          ) : (
            <Wrench size={11} />
          )}
          {server
            ? `MCP · ${server}`
            : tool.source === "server"
              ? "Servidor Anthropic"
              : isAgent
                ? "Delegação a agente"
                : "Ferramenta nativa"}
          <span className="ml-auto normal-case tracking-normal">
            <Badge color={status.badge}>
              {status.icon} {status.text}
            </Badge>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[12.5px] font-medium text-ink-100">{label}</span>
          {tool.durationMs !== undefined && <span className="text-[11px] text-ink-400">{fmtMs(tool.durationMs)}</span>}
          <ChevronDown size={13} className={`ml-auto text-ink-400 transition ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {tool.child && <ChildRun child={tool.child} />}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-2 border-t border-ink-850 p-3">
              {tool.source === "server" && (
                <p className="text-[11.5px] text-ink-400">
                  Executada pela Anthropic durante a chamada ao modelo; o resultado entra no contexto sem passar pelo loop local.
                </p>
              )}
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">entrada (gerada pelo LLM)</div>
              <JsonView value={tool.input} maxHeight={160} />
              {tool.output !== undefined && (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-500">resultado (devolvido ao LLM)</div>
                  <JsonView value={tool.output} maxHeight={220} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const CHILD_STATUS: Record<RunStatus, { text: string; badge: "warn" | "ok" | "bad" }> = {
  running: { text: "Executando", badge: "warn" },
  awaiting_approval: { text: "Aguardando aprovação", badge: "warn" },
  completed: { text: "Concluída", badge: "ok" },
  failed: { text: "Falhou", badge: "bad" },
  cancelled: { text: "Cancelada", badge: "bad" },
};

/** Execução filha acompanhada ao vivo dentro do cartão da delegação. */
function ChildRun({ child }: { child: NonNullable<ToolStep["child"]> }) {
  const [view, dispatch] = useReducer(
    (s: typeof emptyRun, e: RunEvent | { type: "snapshot"; events: RunEvent[] }) =>
      e.type === "snapshot" ? (e as { events: RunEvent[] }).events.reduce(reduceRun, emptyRun) : reduceRun(s, e as RunEvent),
    emptyRun,
  );
  useEventStream<RunEvent | { type: "snapshot"; events: RunEvent[] }>(`/api/runs/${child.runId}/stream`, dispatch);
  const status = CHILD_STATUS[view.status === "idle" ? (child.status ?? "running") : view.status];
  const tools = view.steps.flatMap((s) => (s.kind === "iteration" ? s.tools : []));
  const tokens = view.tokens.input + view.tokens.output + view.childTokens.input + view.childTokens.output;
  return (
    <div className="border-t border-ink-850 bg-ink-950/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-400">
        <span className="font-medium text-ink-200">Execução filha</span>
        <Badge color={status.badge}>
          {status.badge === "warn" && <Loader2 size={10} className="animate-spin" />} {status.text}
        </Badge>
        <span className="tabular-nums">
          {view.iteration} it. · {fmtNumber(tokens)} tokens
        </span>
        <Link to={`/playground/${child.runId}`} className="ml-auto inline-flex items-center gap-1 text-info hover:underline">
          abrir <ArrowUpRight size={11} />
        </Link>
      </div>
      {tools.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tools.map((t) => (
            <span
              key={t.id}
              className={`rounded-full border px-1.5 py-px font-mono text-[10.5px] ${t.status === "running" || t.status === "awaiting_approval" ? "border-warn/40 text-warn" : t.status === "error" || t.status === "denied" ? "border-bad/40 text-bad" : "border-ink-700 text-ink-400"}`}
            >
              {t.source === "agent" ? (t.child?.agentName ?? "agente") : toolLabel(t.name).label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Compaction({ step }: { step: Extract<Step, { kind: "compaction" }> }) {
  const [open, setOpen] = useState(false);
  const pct = step.window ? Math.round((step.tokensBefore / step.window) * 100) : null;
  return (
    <div className="rounded-xl border border-memory/20 bg-memory/[0.05] px-3 py-2.5 text-[12.5px] text-ink-300">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
        <span className="font-medium text-memory">Histórico resumido</span>
        <span className="tabular-nums">
          {step.messagesBefore} mensagens · {fmtNumber(step.tokensBefore)} → ~{fmtNumber(step.tokensAfter)} tokens
        </span>
        {pct !== null && (
          <Badge color="memory">
            {pct}% da janela · limite {step.thresholdPct}%
          </Badge>
        )}
        <ChevronDown size={13} className={`ml-auto text-ink-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1 text-[11.5px] text-ink-400">O modelo resumiu a conversa e a próxima chamada começa só com o resumo.</p>
      {open && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-200">
          {step.summary}
        </pre>
      )}
    </div>
  );
}

function Sources({ items }: { items: Citation[] }) {
  const byUrl = [...new Map(items.map((c) => [c.url, c])).values()];
  return (
    <div className="mt-2.5 rounded-[10px] border border-ink-700 bg-surface p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-400">
        <Link2 size={11} /> Fontes citadas · {byUrl.length}
      </div>
      <ol className="space-y-1.5">
        {byUrl.map((c, i) => (
          <li key={c.url} className="min-w-0 text-[12px] leading-snug">
            <a href={c.url} target="_blank" rel="noreferrer noopener" className="font-medium text-info hover:underline">
              {i + 1}. {c.title || hostOf(c.url)}
            </a>
            <span className="ml-1.5 text-ink-500">{hostOf(c.url)}</span>
            {c.citedText && <div className="mt-0.5 line-clamp-2 text-ink-400">“{c.citedText}”</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Iteration({ step, live }: { step: Extract<Step, { kind: "iteration" }>; live: boolean }) {
  const [showThinking, setShowThinking] = useState(true);
  const streaming = live && step.phase === "llm";
  return (
    <div className={`rounded-2xl border bg-ink-900 p-3.5 ${streaming ? "beam border-accent/30" : "border-ink-700"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Iteração {step.n}</span>
        <Badge color="accent">LLM</Badge>
        {step.messageCount !== undefined && (
          <Badge>
            {step.messageCount} msgs · {step.toolCount} tools
          </Badge>
        )}
        {step.usage && (
          <span className="ml-auto font-mono text-[10.5px] text-ink-400">
            ↑{fmtNumber(step.usage.input)} ↓{fmtNumber(step.usage.output)}
            {step.usage.cacheRead ? ` · cache ${fmtNumber(step.usage.cacheRead)}` : ""} · {fmtMs(step.durationMs ?? 0)}
          </span>
        )}
      </div>

      {(step.thinking || streaming) && (
        <div className="mb-2">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1.5 text-[11.5px] text-ink-400 hover:text-ink-200"
          >
            <span className={streaming && !step.text ? "shimmer-text" : ""}>{streaming && !step.text ? "pensando…" : "raciocínio"}</span>
            <ChevronDown size={12} className={`transition ${showThinking ? "rotate-180" : ""}`} />
          </button>
          {showThinking && step.thinking && (
            <div
              className={`mt-1.5 border-l-2 border-ink-700 pl-3 text-[13px] italic leading-relaxed text-ink-400 ${streaming && !step.text ? "caret" : ""}`}
            >
              {step.thinking}
            </div>
          )}
        </div>
      )}

      {step.text && (
        <div className={streaming ? "caret" : ""}>
          <Markdown text={step.text} />
        </div>
      )}

      {step.tools.length > 0 && (
        <div className="mt-2.5 space-y-2">
          {step.tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      )}

      {step.citations && step.citations.length > 0 && <Sources items={step.citations} />}

      {step.stopReason && (
        <div className="mt-2 font-mono text-[10px] text-ink-500">
          stop_reason: <span className={step.stopReason === "tool_use" ? "text-warn" : "text-ok"}>{step.stopReason}</span>
          {step.stopReason === "tool_use"
            ? " → executar ferramentas e voltar ao LLM"
            : step.stopReason === "pause_turn"
              ? " → pausa do servidor; o loop reenvia para retomar"
              : " → fim do loop"}
        </div>
      )}
    </div>
  );
}

export function Timeline({ steps, live }: { steps: Step[]; live: boolean }) {
  return (
    <div>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const key = `${s.kind}-${i}`;
        switch (s.kind) {
          case "user":
            return (
              <Rail key={key} icon={<User size={14} />} color="#0284c7" last={last}>
                <div className="text-[11px] text-ink-500">Você</div>
                <div className="mt-0.5 rounded-2xl rounded-tl-sm bg-ink-850 px-3.5 py-2.5 text-[14px] text-ink-100">{s.text}</div>
              </Rail>
            );
          case "recall":
            return (
              <Rail key={key} icon={<Brain size={14} />} color="#7c3aed" last={last}>
                <div className="text-[12px] text-ink-300">
                  <b className="font-medium text-memory">{s.memories.length} memórias</b> recuperadas e injetadas no prompt de sistema
                </div>
                <div className="mt-1.5 space-y-1">
                  {s.memories.map((m) => (
                    <div key={m.id} className="flex items-start gap-2 rounded-lg bg-memory/[0.06] px-2.5 py-1.5 text-[12px] text-ink-300">
                      <Badge color="memory">{kindLabel[m.kind] ?? m.kind}</Badge>
                      <span className="flex-1">{m.content}</span>
                      <span className="font-mono text-[10px] text-ink-500">{m.score.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </Rail>
            );
          case "iteration":
            return (
              <Rail
                key={key}
                icon={live && last ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                color="#2563eb"
                last={last}
              >
                <Iteration step={s} live={live && last} />
              </Rail>
            );
          case "memory":
            return (
              <Rail key={key} icon={<Brain size={14} />} color="#7c3aed" last={last}>
                <div className="rounded-xl border border-memory/20 bg-memory/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-ink-300">
                  <span className="mr-1.5 font-medium text-memory">Nova memória</span>
                  <Badge color="memory">{kindLabel[s.memory.kind]}</Badge> {s.memory.content}
                </div>
              </Rail>
            );
          case "compaction":
            return (
              <Rail key={key} icon={<Scissors size={14} />} color="#7c3aed" last={last}>
                <Compaction step={s} />
              </Rail>
            );
          case "final":
            return (
              <Rail key={key} icon={<CheckCircle2 size={14} />} color="#16a34a" last={last}>
                <div className="beam rounded-2xl border border-ok/25 bg-ok/[0.04] p-4 [--beam-color:var(--color-ok)]">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ok">resposta final</div>
                  <Markdown text={s.text || "(sem texto)"} />
                </div>
              </Rail>
            );
          case "error":
            return (
              <Rail key={key} icon={<AlertTriangle size={14} />} color="#dc2626" last={last}>
                <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{s.text}</div>
              </Rail>
            );
        }
      })}
      {live && steps.length > 0 && steps.at(-1)?.kind !== "iteration" && (
        <div className="flex items-center gap-2 pl-11 text-[12px] text-ink-500">
          <CircleDashed size={12} className="animate-spin" /> processando…
        </div>
      )}
    </div>
  );
}
