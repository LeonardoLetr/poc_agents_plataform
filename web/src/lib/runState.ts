import type { Citation, Memory, RunEvent, RunStatus } from "./api";

/**
 * Converte o fluxo de eventos de uma execução em um estado fácil de desenhar:
 * a timeline (passos) e o "nó ativo" do grafo.
 */

export interface ToolStep {
  id: string;
  name: string;
  input: unknown;
  source: "builtin" | "mcp" | "server" | "agent";
  server?: string | undefined;
  /** Multiagente: execução filha iniciada por esta chamada. */
  child?: { runId: string; agentName: string; status?: RunStatus; iterations?: number; usage?: { input: number; output: number } };
  status: "running" | "awaiting_approval" | "done" | "error" | "denied";
  output?: string;
  durationMs?: number;
}

export type Step =
  | { kind: "user"; text: string; ts: string }
  | { kind: "recall"; memories: { id: string; content: string; score: number; kind: string }[]; ts: string }
  | {
      kind: "iteration";
      n: number;
      ts: string;
      thinking: string;
      text: string;
      tools: ToolStep[];
      citations?: Citation[];
      usage?: { input: number; output: number; cacheRead?: number };
      stopReason?: string | null;
      durationMs?: number;
      messageCount?: number;
      toolCount?: number;
      phase: "llm" | "tools" | "done";
    }
  | { kind: "memory"; memory: Memory; ts: string }
  | { kind: "compaction"; ts: string; tokensBefore: number; tokensAfter: number; messagesBefore: number; summary: string; thresholdPct: number; window: number }
  | { kind: "final"; text: string; ts: string }
  | { kind: "error"; text: string; ts: string };

export interface ContextPoint {
  iteration: number;
  tokens: number;
  window: number;
  cacheRead: number;
  breakdown: { system: number; tools: number; history: number };
  messageCount: number;
  /** Houve resumo do histórico antes desta iteração. */
  compactedBefore?: boolean;
}

export interface RunView {
  status: RunStatus | "idle";
  steps: Step[];
  /** Nó em destaque no grafo: "llm", "memory", "scratchpad", nome de ferramenta ou servidor MCP. */
  active: string | null;
  callCounts: Record<string, number>;
  tokens: { input: number; output: number };
  /** Medições da janela de contexto, uma por iteração. */
  context: ContextPoint[];
  /** Iterações precedidas por um resumo do histórico. */
  compactions: number[];
  /** Tokens das execuções delegadas (filhas e netas). */
  childTokens: { input: number; output: number };
  iteration: number;
  model?: string;
  provider?: string;
  pendingApprovals: ToolStep[];
}

export const emptyRun: RunView = {
  status: "idle",
  steps: [],
  active: null,
  callCounts: {},
  tokens: { input: 0, output: 0 },
  childTokens: { input: 0, output: 0 },
  context: [],
  compactions: [],
  iteration: 0,
  pendingApprovals: [],
};

/** Ferramentas executadas pela Anthropic durante a chamada ao modelo (não pelo loop local). */
export const SERVER_TOOL_NAMES = ["web_search", "web_fetch"];

/** Para qual nó do grafo uma ferramenta "aponta". */
export function graphTarget(name: string, server?: string): string {
  // Execução de código interna da filtragem dinâmica: aparece junto ao modelo.
  if (/code_execution/.test(name)) return "llm";
  if (name.startsWith("memory_")) return "memory";
  if (name.startsWith("scratchpad_")) return "scratchpad";
  if (server) return `mcp:${server}`;
  const m = name.match(/^mcp__(.+?)__/);
  if (m) return `mcp:${m[1]}`;
  return `tool:${name}`;
}

function lastIteration(steps: Step[]) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s?.kind === "iteration") return s;
  }
  return null;
}

export function reduceRun(state: RunView, ev: RunEvent): RunView {
  const steps = [...state.steps];
  const updateIter = (fn: (it: Extract<Step, { kind: "iteration" }>) => Extract<Step, { kind: "iteration" }>) => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s?.kind === "iteration") {
        steps[i] = fn({ ...s, tools: [...s.tools] });
        return;
      }
    }
  };

  switch (ev.type) {
    case "run.started":
      return { ...emptyRun, status: "running", steps: [{ kind: "user", text: ev.input, ts: ev.ts }], active: "user", model: ev.model, provider: ev.provider };
    case "user.message":
      return { ...state, status: "running", steps: [...steps, { kind: "user", text: ev.text, ts: ev.ts }], active: "user" };
    case "memory.recalled":
      return { ...state, steps: [...steps, { kind: "recall", memories: ev.memories, ts: ev.ts }], active: "memory" };
    case "iteration.started":
      steps.push({ kind: "iteration", n: ev.iteration, ts: ev.ts, thinking: "", text: "", tools: [], phase: "llm" });
      return { ...state, steps, iteration: ev.iteration, active: "llm" };
    case "llm.request":
      updateIter((it) => ({ ...it, messageCount: ev.messageCount, toolCount: ev.toolCount }));
      return { ...state, steps, active: "llm" };
    case "thinking.delta":
      updateIter((it) => ({ ...it, thinking: it.thinking + ev.text }));
      return { ...state, steps };
    case "text.delta":
      updateIter((it) => ({ ...it, text: it.text + ev.text }));
      return { ...state, steps };
    case "llm.response":
      updateIter((it) => ({ ...it, usage: ev.usage, stopReason: ev.stopReason, durationMs: ev.durationMs, phase: ev.stopReason === "tool_use" ? "tools" : "done" }));
      return {
        ...state,
        steps,
        model: ev.model,
        tokens: { input: state.tokens.input + ev.usage.input, output: state.tokens.output + ev.usage.output },
      };
    case "tool.call": {
      updateIter((it) => ({ ...it, tools: [...it.tools, { id: ev.id, name: ev.name, input: ev.input, source: ev.source, server: ev.server, status: "running" }] }));
      const target = graphTarget(ev.name, ev.server);
      return { ...state, steps, active: target, callCounts: { ...state.callCounts, [target]: (state.callCounts[target] ?? 0) + 1 } };
    }
    case "tool.approval_requested": {
      let pending: ToolStep | undefined;
      updateIter((it) => ({
        ...it,
        tools: it.tools.map((t) => (t.id === ev.id ? (pending = { ...t, status: "awaiting_approval" }) : t)),
      }));
      return { ...state, steps, status: "awaiting_approval", pendingApprovals: pending ? [...state.pendingApprovals, pending] : state.pendingApprovals };
    }
    case "tool.approval_resolved": {
      const pendingApprovals = state.pendingApprovals.filter((p) => p.id !== ev.id);
      updateIter((it) => ({ ...it, tools: it.tools.map((t) => (t.id === ev.id ? { ...t, status: ev.approved ? "running" : "denied" } : t)) }));
      return { ...state, steps, pendingApprovals, status: pendingApprovals.length ? "awaiting_approval" : "running" };
    }
    case "tool.result":
      updateIter((it) => ({
        ...it,
        tools: it.tools.map((t) => (t.id === ev.id ? { ...t, status: t.status === "denied" ? "denied" : ev.isError ? "error" : "done", output: ev.output, durationMs: ev.durationMs } : t)),
      }));
      return { ...state, steps };
    case "delegation.started":
      updateIter((it) => ({ ...it, tools: it.tools.map((t) => (t.id === ev.toolUseId ? { ...t, child: { runId: ev.childRunId, agentName: ev.agentName, status: "running" } } : t)) }));
      return { ...state, steps };
    case "delegation.finished":
      updateIter((it) => ({
        ...it,
        tools: it.tools.map((t) => (t.id === ev.toolUseId && t.child ? { ...t, child: { ...t.child, status: ev.status, iterations: ev.iterations, usage: ev.usage } } : t)),
      }));
      return { ...state, steps, childTokens: { input: state.childTokens.input + ev.usage.input, output: state.childTokens.output + ev.usage.output } };
    case "context.measured": {
      const compactedBefore = state.compactions.includes(ev.iteration);
      return { ...state, context: [...state.context, { iteration: ev.iteration, tokens: ev.tokens, window: ev.window, cacheRead: ev.cacheRead, breakdown: ev.breakdown, messageCount: ev.messageCount, compactedBefore }] };
    }
    case "context.compacted": {
      const window = state.context[state.context.length - 1]?.window ?? 0;
      return { ...state, steps: [...steps, { kind: "compaction", ts: ev.ts, tokensBefore: ev.tokensBefore, tokensAfter: ev.tokensAfter, messagesBefore: ev.messagesBefore, summary: ev.summary, thresholdPct: ev.thresholdPct, window }], compactions: [...state.compactions, ev.iteration] };
    }
    case "citations":
      updateIter((it) => ({ ...it, citations: [...(it.citations ?? []), ...ev.items] }));
      return { ...state, steps };
    case "memory.created":
      return { ...state, steps: [...steps, { kind: "memory", memory: ev.memory, ts: ev.ts }], active: "memory" };
    case "run.completed": {
      const it = lastIteration(steps);
      if (it) updateIter((x) => ({ ...x, phase: "done" }));
      return { ...state, steps: [...steps, { kind: "final", text: ev.output, ts: ev.ts }], status: "completed", active: "user" };
    }
    case "run.failed":
      return { ...state, steps: [...steps, { kind: "error", text: ev.error, ts: ev.ts }], status: "failed", active: null, pendingApprovals: [] };
    case "run.cancelled":
      return { ...state, steps: [...steps, { kind: "error", text: "Execução cancelada.", ts: ev.ts }], status: "cancelled", active: null, pendingApprovals: [] };
    default:
      return state;
  }
}
