import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Coins, History, Layers, Loader2, Repeat, Send, Square, Timer, Users } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ContextMeter } from "../components/ContextMeter";
import { ReplayBar, replayOff, type ReplayState } from "../components/ReplayBar";
import { AgentGraph } from "../components/AgentGraph";
import { LiveDot } from "../components/effects";
import { JsonView } from "../components/JsonView";
import { Timeline } from "../components/Timeline";
import { Badge, Button, Card, ErrorNote, Modal, Textarea } from "../components/ui";
import { api, type Agent, type Llm, type RunDetail, type RunEvent, type RunSummary, type ToolInfo } from "../lib/api";
import { fmtNumber, timeAgo, toolLabel } from "../lib/format";
import { useEventStream, useResource } from "../lib/hooks";
import { viewAt } from "../lib/replay";
import { emptyRun, reduceRun, type RunView } from "../lib/runState";

type Action = { type: "reset" } | { type: "snapshot"; events: RunEvent[] } | { type: "event"; event: RunEvent };

function reducer(state: RunView, action: Action): RunView {
  if (action.type === "reset") return emptyRun;
  if (action.type === "snapshot") return action.events.reduce(reduceRun, emptyRun);
  return reduceRun(state, action.event);
}

/** Deltas de texto/pensamento seguidos são agrupados, como no histórico salvo pelo núcleo. */
function mergeDelta(list: RunEvent[], ev: RunEvent): RunEvent[] {
  const last = list[list.length - 1];
  if (last && last.type === ev.type && (ev.type === "text.delta" || ev.type === "thinking.delta")) {
    return [...list.slice(0, -1), { ...last, text: (last as { text: string }).text + ev.text } as RunEvent];
  }
  return [...list, ev];
}

const EXAMPLES: Record<string, string[]> = {
  demo: ["Quanto é (1250 * 1.08) ^ 2 e que horas são agora?", "Lembre que eu prefiro café sem açúcar", "Role 2d20 e adicione a nota: estudar MCP amanhã", "Resuma https://example.com"],
  default: [
    "Pesquise o que é o Model Context Protocol em https://modelcontextprotocol.io e salve o principal na memória",
    "Se eu investir R$ 1.500 por mês a 0,9% ao mês, quanto terei em 10 anos? Mostre as contas.",
    "O que você lembra sobre mim?",
    "Converta 42 km para milhas e role 3d6 usando o servidor MCP",
  ],
  // Agentes de e-mail: o agente mostra o rascunho e só envia após a confirmação.
  email: [
    "Escreva um e-mail para meu-email@exemplo.com com o assunto \"Teste do Agent Lab\" dizendo que o agente de e-mail está funcionando",
    "Redija um convite para uma reunião de alinhamento na sexta às 10h para equipe@exemplo.com",
  ],
  // Agentes que delegam (com outros agentes como ferramentas) ganham exemplos de tarefa em equipe.
  team: [
    "Pesquise o preço médio atual do litro da gasolina no Brasil e calcule quanto custa rodar 1.200 km com um carro que faz 11 km/l",
    "Compare a população das 3 maiores capitais do Brasil e calcule a diferença percentual entre a maior e a menor, citando as fontes",
  ],
};

export default function Playground() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const agents = useResource<Agent[]>("/api/agents");
  const tools = useResource<ToolInfo[]>("/api/tools");
  const llms = useResource<Llm[]>("/api/llms");
  const llmOf = (a: Agent | null | undefined) => llms.data?.find((l) => l.id === a?.llmId);
  const runs = useResource<RunSummary[]>("/api/runs");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [liveView, dispatch] = useReducer(reducer, emptyRun);
  // Eventos da execução aberta, guardados para o replay.
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [replay, setReplay] = useState<ReplayState>(replayOff);
  const [runAgentId, setRunAgentId] = useState<string | null>(null);
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [inspect, setInspect] = useState<"system" | "messages" | "scratchpad" | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Agente selecionado: o da execução aberta, ou o primeiro da lista.
  useEffect(() => {
    if (!agentId && agents.data?.length) setAgentId(agents.data.find((a) => a.llmId === "llm_demo")?.id ?? agents.data[0].id);
  }, [agents.data, agentId]);

  useEffect(() => {
    if (!runId) dispatch({ type: "reset" });
    setEvents([]);
    setReplay(replayOff);
    setParentRunId(null);
  }, [runId]);

  useEventStream<RunEvent | { type: "snapshot"; run: RunSummary; events: RunEvent[] }>(runId ? `/api/runs/${runId}/stream` : null, (msg) => {
    if (msg.type === "snapshot") {
      const m = msg as { run: RunSummary; events: RunEvent[] };
      setRunAgentId(m.run.agentId);
      setAgentId(m.run.agentId);
      setParentRunId(m.run.parentRunId ?? null);
      dispatch({ type: "snapshot", events: m.events });
      setEvents(m.events);
    } else {
      dispatch({ type: "event", event: msg as RunEvent });
      if (msg.type !== "text.delta" && msg.type !== "thinking.delta") setEvents((list) => [...list, msg as RunEvent]);
      else setEvents((list) => mergeDelta(list, msg as RunEvent));
      if (msg.type === "run.completed" || msg.type === "run.failed" || msg.type === "run.cancelled") void runs.reload();
    }
  });

  // Ferramentas MCP aparecem/somem conforme os servidores conectam.
  useEventStream("/api/mcp/events", () => void tools.reload());

  const agent = useMemo(() => agents.data?.find((a) => a.id === (runId ? runAgentId ?? agentId : agentId)) ?? null, [agents.data, agentId, runAgentId, runId]);
  // Em replay, toda a tela (grafo, linha do tempo, métricas) mostra o estado na posição escolhida.
  const replaying = replay.position !== null;
  const replayView = useMemo(() => (replay.position === null ? null : viewAt(events, replay.position)), [events, replay.position]);
  const view = replayView ?? liveView;
  const live = !replaying && (view.status === "running" || view.status === "awaiting_approval");
  const canReplay = Boolean(runId) && !(liveView.status === "running" || liveView.status === "awaiting_approval") && events.length > 1;

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [view.steps]);
  const agentLlm = llmOf(agent);
  const delegates = agent?.tools.some((t) => t.startsWith("agent__")) ?? false;
  // Exemplos de e-mail para o assistente de e-mail ou agentes com servidores MCP de e-mail conhecidos.
  const emailer = Boolean(agent && (/e-?mail/i.test(agent.name) || agent.tools.some((t) => /^mcp__.*(resend|zapier|gmail|brevo|mail).*__/i.test(t))));
  const examples = agentLlm?.provider === "demo" ? EXAMPLES.demo : emailer ? EXAMPLES.email : delegates ? EXAMPLES.team : EXAMPLES.default;

  async function start(text = input) {
    if (!agent || !text.trim()) return;
    setError(null);
    try {
      const { id } = await api.post<{ id: string }>("/api/runs", { agentId: agent.id, input: text.trim() });
      setRunAgentId(agent.id);
      setInput("");
      dispatch({ type: "reset" });
      navigate(`/playground/${id}`);
      void runs.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendFollowUp() {
    if (!runId || !followUp.trim()) return;
    try {
      setReplay(replayOff);
      await api.post(`/api/runs/${runId}/messages`, { text: followUp.trim() });
      setFollowUp("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openInspector(tab: "system" | "messages" | "scratchpad") {
    if (!runId) return;
    setDetail(await api.get<RunDetail>(`/api/runs/${runId}`));
    setInspect(tab);
  }

  // Aprovações são sempre do estado ao vivo: no replay, pedidos antigos não devem reaparecer.
  const approval = liveView.pendingApprovals[0];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink-100">Playground</h1>
          <p className="mt-1 text-[13px] text-ink-400">Execute uma tarefa e acompanhe o raciocínio, as ferramentas e o consumo de cada iteração</p>
        </div>
        <RecentRuns runs={runs.data ?? []} current={runId} />
      </div>

      {/* Seletor de agente */}
      <div className="mb-4 flex flex-wrap gap-2">
        {agents.data?.map((a) => (
          <button
            key={a.id}
            disabled={live}
            onClick={() => {
              setAgentId(a.id);
              if (runId) navigate("/playground");
            }}
            className={`relative flex shrink-0 items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left transition ${
              agent?.id === a.id ? "border-ink-600 bg-surface shadow-[0_1px_2px_rgb(31_30_28/0.06)]" : "border-ink-700 hover:bg-surface/70"
            } disabled:opacity-50`}
          >
            {agent?.id === a.id && <motion.div layoutId="agent-pick" className="absolute inset-x-3 -bottom-px h-px" style={{ background: a.color }} />}
            <span className="text-xl">{a.emoji}</span>
            <span>
              <span className="block text-[13px] font-medium">{a.name}</span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
                {llmOf(a) && <span className={`h-1.5 w-1.5 rounded-full ${llmOf(a)!.ready ? "bg-ok" : "bg-warn"}`} title={llmOf(a)!.ready ? "LLM pronta" : "LLM sem chave"} />}
                {llmOf(a)?.name ?? "sem LLM"}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Entrada da tarefa */}
      <Card className="mb-6 p-2 transition focus-within:border-accent/40 focus-within:ring-[3px] focus-within:ring-accent/10">
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={input}
            placeholder={agent ? `Dê uma tarefa para ${agent.name}…` : "Carregando agentes…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void start();
              }
            }}
            className="resize-none !border-0 !bg-transparent !shadow-none !ring-0"
          />
          <Button variant="primary" onClick={() => start()} disabled={!input.trim() || !agent || live} className="h-11 w-11 shrink-0 !px-0" aria-label="Executar">
            {live ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-1">
          {examples.map((ex) => (
            <button key={ex} onClick={() => setInput(ex)} className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-1 text-[11.5px] text-ink-300 transition hover:border-accent/40 hover:text-ink-100">
              {ex.length > 60 ? `${ex.slice(0, 58)}…` : ex}
            </button>
          ))}
        </div>
      </Card>
      {agentLlm && !agentLlm.ready && !live && (
        <div className="mb-4 rounded-xl border border-warn/25 bg-warn/[0.06] px-3.5 py-2.5 text-[13px] text-ink-300">
          🔑 A LLM <b className="text-warn">{agentLlm.name}</b> deste agente ainda não tem chave.{" "}
          <Link to="/llms" className="text-info underline">Configure em LLMs</Link> ou escolha o <b>Agente Demo</b>, que roda sem chave.
        </div>
      )}
      <ErrorNote message={error} />
      {runId && parentRunId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-memory/25 bg-memory/[0.06] px-3.5 py-2.5 text-[13px] text-ink-300">
          <Users size={14} className="text-memory" /> Esta execução foi delegada por outro agente.
          <Link to={`/playground/${parentRunId}`} className="text-info underline">Abrir execução pai</Link>
        </div>
      )}

      {canReplay && <ReplayBar events={events} state={replay} onChange={setReplay} />}

      <div className="grid gap-6 xl:grid-cols-12">
        {/* Grafo + métricas */}
        <div className="space-y-4 xl:col-span-7">
          <Card className="relative h-[460px] overflow-hidden">
            <div className="absolute left-4 top-3 z-10 flex items-center gap-2 text-[12px] text-ink-300">
              <LiveDot color={live ? "bg-ok" : "bg-ink-500"} active={live} />
              {replaying ? "replay" : live ? "execução ao vivo" : view.status === "idle" ? "mapa do agente" : `execução ${view.status === "completed" ? "concluída" : view.status === "failed" ? "falhou" : "cancelada"}`}
            </div>
            {live && (
              <Button size="sm" variant="danger" className="absolute right-3 top-3 z-10" onClick={() => api.post(`/api/runs/${runId}/cancel`)}>
                <Square size={12} /> parar
              </Button>
            )}
            {agent && <AgentGraph agent={agent} tools={tools.data ?? []} view={view} llmLabel={agentLlm ? `${agentLlm.name}` : "sem LLM"} />}
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric icon={<Repeat size={11} />} label="Iterações" value={view.iteration} />
            <Metric icon={<ArrowUp size={11} />} label="Tokens entrada" value={view.tokens.input} hint={view.childTokens.input ? `+${fmtNumber(view.childTokens.input)} delegados` : undefined} />
            <Metric icon={<Coins size={11} />} label="Tokens saída" value={view.tokens.output} hint={view.childTokens.output ? `+${fmtNumber(view.childTokens.output)} delegados` : undefined} />
            <Metric icon={<Timer size={11} />} label="Ferramentas" value={Object.values(view.callCounts).reduce((a, b) => a + b, 0)} />
          </div>

          <ContextMeter points={view.context} threshold={agent?.context} />

          {runId && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
                <Layers size={15} className="text-info" /> Inspecionar o contexto enviado ao LLM
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openInspector("system")}>Prompt de sistema</Button>
                <Button size="sm" onClick={() => openInspector("messages")}>Mensagens (janela de contexto)</Button>
                <Button size="sm" onClick={() => openInspector("scratchpad")}>Scratchpad</Button>
                <Link to={`/audit?runId=${runId}`}>
                  <Button size="sm" variant="subtle">Ver na auditoria →</Button>
                </Link>
              </div>
            </Card>
          )}
        </div>

        {/* Timeline */}
        <div className="xl:col-span-5">
          <Card className="flex h-[720px] flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
              <div className="text-[13px] font-medium">Linha do tempo do raciocínio</div>
              {view.model && <Badge color={view.provider === "demo" ? "ok" : "accent"}>{view.model}</Badge>}
            </div>
            <div ref={timelineRef} className="flex-1 overflow-y-auto p-4">
              {view.steps.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-ink-400">
                  <div className="mb-3 text-4xl">{agent?.emoji ?? "🤖"}</div>
                  <div className="text-sm">Dê uma tarefa e acompanhe cada passo:</div>
                  <div className="mt-2 max-w-xs text-[12px] text-ink-500">raciocínio → chamada de ferramenta → resultado → nova decisão… até a resposta final.</div>
                </div>
              ) : (
                <Timeline steps={view.steps} live={live} />
              )}
            </div>
            {runId && !live && view.status !== "idle" && (
              <div className="border-t border-ink-700 p-3">
                <div className="flex gap-2">
                  <Textarea
                    rows={1}
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendFollowUp();
                      }
                    }}
                    placeholder="Continuar a conversa…"
                    className="resize-none"
                  />
                  <Button variant="primary" onClick={sendFollowUp} disabled={!followUp.trim()} className="shrink-0">
                    <Send size={15} />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Aprovação humana (human-in-the-loop) */}
      <Modal open={Boolean(approval)} onClose={() => undefined} title="✋ O agente quer usar uma ferramenta">
        {approval && (
          <div className="space-y-4">
            <p className="text-sm text-ink-300">
              Este agente exige aprovação humana. Ele pediu para executar <b className="font-mono text-warn">{toolLabel(approval.name).label}</b>
              {approval.server && <> no servidor MCP <b className="text-mcp">{approval.server}</b></>} com estes argumentos:
            </p>
            <JsonView value={approval.input} />
            <div className="flex justify-end gap-2">
              <Button variant="danger" onClick={() => api.post(`/api/runs/${runId}/approve`, { toolUseId: approval.id, approved: false })}>Negar</Button>
              <Button variant="primary" onClick={() => api.post(`/api/runs/${runId}/approve`, { toolUseId: approval.id, approved: true })}>Aprovar e executar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={inspect !== null} onClose={() => setInspect(null)} wide title={inspect === "system" ? "Prompt de sistema montado para esta execução" : inspect === "messages" ? `Janela de contexto (${detail?.messages.length ?? 0} mensagens)` : "Scratchpad (memória de trabalho)"}>
        {detail && inspect === "system" && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-ink-900 p-4 font-mono text-[12px] leading-relaxed text-ink-200">{detail.systemPrompt}</pre>
        )}
        {detail && inspect === "messages" && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-400">
              É exatamente isto que é reenviado ao modelo a cada iteração. Repare como as mensagens <code className="text-info">tool_use</code> (do assistente) e{" "}
              <code className="text-info">tool_result</code> (do "usuário") se alternam — esse é o protocolo de ferramentas.
            </p>
            {detail.messages.map((m, i) => (
              <div key={i}>
                <Badge color={(m as { role: string }).role === "user" ? "info" : "accent"}>
                  #{i} {(m as { role: string }).role}
                </Badge>
                <JsonView value={(m as { content: unknown }).content} className="mt-1" maxHeight={220} />
              </div>
            ))}
          </div>
        )}
        {detail && inspect === "scratchpad" &&
          (detail.scratchpad.length ? (
            <ol className="space-y-2">
              {detail.scratchpad.map((n, i) => (
                <li key={i} className="rounded-xl bg-ok/5 px-3 py-2 text-sm text-ink-200">
                  <span className="mr-2 font-mono text-ok">{i + 1}.</span>
                  {n}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-400">O agente não escreveu nada no scratchpad nesta execução.</p>
          ))}
      </Modal>
    </div>
  );
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-400">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-ink-850 text-ink-300">{icon}</span> {label}
      </div>
      <AnimatePresence mode="popLayout">
        <motion.div key={value} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink-100">
          {fmtNumber(value)}
        </motion.div>
      </AnimatePresence>
      {hint && <div className="mt-1.5 text-[11px] text-ink-400">{hint}</div>}
    </Card>
  );
}

function RecentRuns({ runs, current }: { runs: RunSummary[]; current?: string }) {
  const [open, setOpen] = useState(false);
  const color = { running: "text-warn", awaiting_approval: "text-warn", completed: "text-ok", failed: "text-bad", cancelled: "text-ink-400" };
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen(!open)}>
        <History size={14} /> Execuções recentes
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="absolute right-0 z-30 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-ink-700 bg-surface p-1.5 shadow-2xl backdrop-blur-xl">
            {runs.length === 0 && <div className="p-3 text-sm text-ink-400">Nenhuma execução ainda.</div>}
            {runs.map((r) => (
              <Link key={r.id} to={`/playground/${r.id}`} onClick={() => setOpen(false)} className={`block rounded-xl px-3 py-2 transition hover:bg-ink-850 ${r.id === current ? "bg-ink-850" : ""}`}>
                <div className="truncate text-[13px] text-ink-100">{r.input}</div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-ink-500">
                  <span className={color[r.status]}>●</span> {r.parentRunId ? "↳ " : ""}{r.agentName}{r.parentRunId ? " (delegada)" : ""} · {timeAgo(r.startedAt)} · {r.iterations} it.
                </div>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

