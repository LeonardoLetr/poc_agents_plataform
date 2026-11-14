import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, CircleDashed, Hand, Loader2, MessageSquare, Plug, Sparkles, User, Wrench, XCircle } from "lucide-react";
import { useState } from "react";
import { fmtMs, fmtNumber, kindLabel, toolLabel } from "../lib/format";
import type { Step, ToolStep } from "../lib/runState";
import { JsonView } from "./JsonView";
import { Markdown } from "./Markdown";
import { Badge } from "./ui";

const enter = { initial: { opacity: 0, y: 14, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { type: "spring" as const, stiffness: 300, damping: 28 } };

function Rail({ icon, color, children, last }: { icon: React.ReactNode; color: string; children: React.ReactNode; last?: boolean }) {
  return (
    <motion.div {...enter} className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <div className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10" style={{ background: `color-mix(in oklab, ${color} 18%, #0a0a12)`, color }}>
          {icon}
        </div>
        {!last && <div className="w-px flex-1 bg-gradient-to-b from-white/15 to-transparent" />}
      </div>
      <div className="min-w-0 flex-1 pb-5">{children}</div>
    </motion.div>
  );
}

function ToolCard({ tool }: { tool: ToolStep }) {
  const [open, setOpen] = useState(false);
  const { label, server } = toolLabel(tool.name);
  const status = {
    running: { icon: <Loader2 size={13} className="animate-spin" />, color: "text-amber", text: "executando" },
    awaiting_approval: { icon: <Hand size={13} />, color: "text-amber", text: "aguardando aprovação" },
    done: { icon: <CheckCircle2 size={13} />, color: "text-mint", text: "ok" },
    error: { icon: <XCircle size={13} />, color: "text-rose", text: "erro" },
    denied: { icon: <XCircle size={13} />, color: "text-rose", text: "negada" },
  }[tool.status];
  return (
    <motion.div layout {...enter} className={`overflow-hidden rounded-xl border bg-ink-900/60 ${tool.status === "running" ? "beam border-amber/30 [--beam-color:var(--color-amber)]" : "border-white/8"}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {server ? <Plug size={13} className="text-pink" /> : <Wrench size={13} className="text-amber" />}
        <span className="font-mono text-[12px] text-ink-100">{label}</span>
        {server && <Badge color="pink">mcp:{server}</Badge>}
        <span className={`ml-auto flex items-center gap-1 text-[11px] ${status.color}`}>
          {status.icon} {status.text}
          {tool.durationMs !== undefined && <span className="text-ink-500">· {fmtMs(tool.durationMs)}</span>}
        </span>
        <ChevronDown size={14} className={`text-ink-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-2 border-t border-white/5 p-3">
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

function Iteration({ step, live }: { step: Extract<Step, { kind: "iteration" }>; live: boolean }) {
  const [showThinking, setShowThinking] = useState(true);
  const streaming = live && step.phase === "llm";
  return (
    <div className={`rounded-2xl border bg-white/[0.02] p-3.5 ${streaming ? "beam border-violet/30" : "border-white/8"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Iteração {step.n}</span>
        <Badge color="violet">LLM</Badge>
        {step.messageCount !== undefined && <Badge>{step.messageCount} msgs · {step.toolCount} tools</Badge>}
        {step.usage && (
          <span className="ml-auto font-mono text-[10.5px] text-ink-400">
            ↑{fmtNumber(step.usage.input)} ↓{fmtNumber(step.usage.output)}
            {step.usage.cacheRead ? ` · cache ${fmtNumber(step.usage.cacheRead)}` : ""} · {fmtMs(step.durationMs ?? 0)}
          </span>
        )}
      </div>

      {(step.thinking || streaming) && (
        <div className="mb-2">
          <button onClick={() => setShowThinking(!showThinking)} className="flex items-center gap-1.5 text-[11.5px] text-ink-400 hover:text-ink-200">
            <Sparkles size={12} className="text-violet-300" />
            <span className={streaming && !step.text ? "shimmer-text" : ""}>{streaming && !step.text ? "pensando…" : "raciocínio"}</span>
            <ChevronDown size={12} className={`transition ${showThinking ? "rotate-180" : ""}`} />
          </button>
          {showThinking && step.thinking && (
            <div className={`mt-1.5 border-l-2 border-violet/30 pl-3 font-serif text-[15px] italic leading-snug text-ink-300 ${streaming && !step.text ? "caret" : ""}`}>{step.thinking}</div>
          )}
        </div>
      )}

      {step.text && (
        <div className={streaming ? "caret" : ""}>
          <Markdown text={step.text} />
        </div>
      )}

      {step.tools.length > 0 && <div className="mt-2.5 space-y-2">{step.tools.map((t) => <ToolCard key={t.id} tool={t} />)}</div>}

      {step.stopReason && (
        <div className="mt-2 font-mono text-[10px] text-ink-500">
          stop_reason: <span className={step.stopReason === "tool_use" ? "text-amber" : "text-mint"}>{step.stopReason}</span>
          {step.stopReason === "tool_use" ? " → executar ferramentas e voltar ao LLM" : " → fim do loop"}
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
              <Rail key={key} icon={<User size={14} />} color="#22d3ee" last={last}>
                <div className="text-[11px] text-ink-500">Você</div>
                <div className="mt-0.5 rounded-2xl rounded-tl-sm bg-cyan/10 px-3.5 py-2.5 text-[14px] text-ink-100">{s.text}</div>
              </Rail>
            );
          case "recall":
            return (
              <Rail key={key} icon={<Brain size={14} />} color="#a78bfa" last={last}>
                <div className="text-[12px] text-ink-300">
                  <b className="text-violet-300">{s.memories.length} memórias</b> recuperadas e injetadas no prompt de sistema
                </div>
                <div className="mt-1.5 space-y-1">
                  {s.memories.map((m) => (
                    <div key={m.id} className="flex items-start gap-2 rounded-lg bg-violet/5 px-2.5 py-1.5 text-[12px] text-ink-300">
                      <Badge color="violet">{kindLabel[m.kind] ?? m.kind}</Badge>
                      <span className="flex-1">{m.content}</span>
                      <span className="font-mono text-[10px] text-ink-500">{m.score.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </Rail>
            );
          case "iteration":
            return (
              <Rail key={key} icon={live && last ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} color="#8b5cf6" last={last}>
                <Iteration step={s} live={live && last} />
              </Rail>
            );
          case "memory":
            return (
              <Rail key={key} icon={<Brain size={14} />} color="#a78bfa" last={last}>
                <div className="rounded-xl border border-violet/20 bg-violet/5 px-3 py-2 text-[12.5px] text-ink-300">
                  <span className="mr-1.5 text-violet-300">💾 Nova memória</span>
                  <Badge color="violet">{kindLabel[s.memory.kind]}</Badge> {s.memory.content}
                </div>
              </Rail>
            );
          case "final":
            return (
              <Rail key={key} icon={<CheckCircle2 size={14} />} color="#34d399" last={last}>
                <div className="beam rounded-2xl border border-mint/25 bg-mint/[0.04] p-4 [--beam-color:var(--color-mint)]">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-mint">resposta final</div>
                  <Markdown text={s.text || "(sem texto)"} />
                </div>
              </Rail>
            );
          case "error":
            return (
              <Rail key={key} icon={<AlertTriangle size={14} />} color="#fb7185" last={last}>
                <div className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-[13px] text-rose">{s.text}</div>
              </Rail>
            );
        }
      })}
      {live && steps.length > 0 && steps[steps.length - 1].kind !== "iteration" && (
        <div className="flex items-center gap-2 pl-11 text-[12px] text-ink-500">
          <CircleDashed size={12} className="animate-spin" /> processando…
        </div>
      )}
    </div>
  );
}
