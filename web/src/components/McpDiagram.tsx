import { motion } from "motion/react";
import { Bot, Cpu, Pause, Play, Plug, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Canvas explicando o MCP: o modelo, o Agent Lab (cliente MCP) e um servidor MCP com suas ferramentas.
 * Um pacote percorre as ligações etapa por etapa, em ritmo de leitura; clicar numa etapa pausa nela.
 */

type NodeId = "llm" | "client" | "server";
type Path = [[NodeId, NodeId], ...[NodeId, NodeId][]];
const NODES: Record<NodeId, { x: number; label: string; sub: string; icon: typeof Bot; color: string }> = {
  llm: { x: 16, label: "Modelo", sub: "Claude, GPT…", icon: Cpu, color: "var(--color-accent)" },
  client: { x: 50, label: "Agent Lab", sub: "cliente MCP", icon: Bot, color: "var(--color-info)" },
  server: { x: 84, label: "Servidor MCP", sub: "ex.: zapier", icon: Plug, color: "var(--color-mcp)" },
};
const NODE_Y = 42;
const TOOLS = ["send_email", "create_draft", "find_email"];

interface Step {
  title: string;
  label: string;
  text: string;
  /** Trechos percorridos pelo pacote, em ordem. */
  path: Path;
  /** Ferramenta em destaque (índice em TOOLS); "all" acende todas. */
  tool?: number | "all";
}

const STEPS: [Step, ...Step[]] = [
  { title: "Conectar", label: "initialize", text: "O Agent Lab abre a conexão e os dois lados combinam a versão do protocolo e o que cada um suporta.", path: [["client", "server"]] },
  {
    title: "Descobrir",
    label: "tools/list",
    text: "O servidor anuncia suas ferramentas, com nome, descrição e argumentos. Para os agentes, elas viram mcp__servidor__ferramenta.",
    path: [["server", "client"]],
    tool: "all",
  },
  { title: "Decidir", label: "tool_use", text: "O Agent Lab envia as ferramentas ao modelo junto com a tarefa; o modelo escolhe uma e gera os argumentos.", path: [["client", "llm"], ["llm", "client"]] },
  { title: "Chamar", label: "tools/call", text: "O Agent Lab repassa a chamada ao servidor, que executa a ferramenta escolhida.", path: [["client", "server"]], tool: 0 },
  { title: "Responder", label: "tool_result", text: "O resultado volta ao Agent Lab e segue para o modelo, que decide o próximo passo ou responde.", path: [["server", "client"], ["client", "llm"]], tool: 0 },
];

const STEP_MS = 4200;
const HOP_S = 1.1;

/** Posição de cada ferramenta: em leque abaixo do servidor; em telas estreitas, em coluna. */
const toolPos = (i: number, narrow: boolean) => (narrow ? { x: NODES.server.x, y: 66 + i * 11 } : { x: NODES.server.x + (i - 1) * 9, y: 78 });

export function McpDiagram() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const fit = () => setNarrow(window.innerWidth < 640);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [step, playing]);

  const current = STEPS[step] ?? STEPS[0];
  const activeNodes = new Set(current.path.flat());
  const activeEdge = (a: NodeId, b: NodeId) => current.path.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  return (
    <div>
      <div className="relative h-[260px] overflow-hidden rounded-xl bg-ink-950 [background-image:radial-gradient(var(--color-ink-700)_1px,transparent_1px)] [background-size:16px_16px]">
        {/* Ligações e pacote em movimento */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {(
            [
              ["llm", "client"],
              ["client", "server"],
            ] as [NodeId, NodeId][]
          ).map(([a, b]) => (
            <line
              key={a + b}
              x1={NODES[a].x}
              y1={NODE_Y}
              x2={NODES[b].x}
              y2={NODE_Y}
              stroke={activeEdge(a, b) ? "var(--color-accent)" : "var(--color-ink-600)"}
              strokeWidth={activeEdge(a, b) ? 0.5 : 0.35}
              strokeDasharray={activeEdge(a, b) ? "0" : "1.2 1.8"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Servidor → ferramentas */}
          {TOOLS.map((_, i) => {
            const p = toolPos(i, narrow);
            return <line key={i} x1={NODES.server.x} y1={NODE_Y + 8} x2={p.x} y2={p.y} stroke="var(--color-ink-700)" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        <Packet key={step} path={current.path} />

        {/* Rótulo da mensagem sobre a ligação ativa */}
        <motion.div
          key={`label-${step}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -translate-x-1/2 rounded-full border border-accent/40 bg-surface px-2 py-0.5 font-mono text-[11px] text-accent"
          style={{ left: `${(NODES[current.path[0][0]].x + NODES[current.path[0][1]].x) / 2}%`, top: `calc(${NODE_Y}% - ${narrow ? 58 : 34}px)` }}
        >
          {current.label}
        </motion.div>

        {(Object.keys(NODES) as NodeId[]).map((id) => {
          const n = NODES[id];
          const Icon = n.icon;
          const on = activeNodes.has(id);
          return (
            <div key={id} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: `${n.x}%`, top: `${NODE_Y}%` }}>
              <motion.div
                className="flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 sm:px-3"
                animate={{ boxShadow: on ? `0 0 0 4px color-mix(in oklab, ${n.color} 22%, transparent)` : "0 0 0 0px transparent", borderColor: on ? n.color : "var(--color-ink-700)" }}
                transition={{ duration: 0.4 }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: n.color, background: `color-mix(in oklab, ${n.color} 14%, transparent)` }}>
                  <Icon size={15} />
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block whitespace-nowrap text-[12.5px] font-medium text-ink-100">{n.label}</span>
                  <span className="block whitespace-nowrap font-mono text-[10px] text-ink-400">{n.sub}</span>
                </span>
              </motion.div>
              <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-ink-200 sm:hidden">{n.label}</span>
            </div>
          );
        })}

        {/* Ferramentas do servidor */}
        {TOOLS.map((t, i) => {
          const on = current.tool === "all" || current.tool === i;
          const p = toolPos(i, narrow);
          return (
            <motion.div
              key={t}
              className="absolute flex -translate-x-1/2 items-center gap-1 rounded-full border bg-surface px-1.5 py-0.5 font-mono text-[10px] sm:px-2 sm:text-[10.5px]"
              style={{ left: `${narrow ? Math.min(p.x, 82) : p.x}%`, top: `${p.y}%` }}
              animate={{ borderColor: on ? "var(--color-mcp)" : "var(--color-ink-700)", color: on ? "var(--color-mcp)" : "var(--color-ink-400)" }}
            >
              <Wrench size={9} className="hidden sm:block" /> {t.split("_")[0]}
            </motion.div>
          );
        })}
      </div>

      {/* Etapas: avançam sozinhas; clicar em uma pausa nela */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setPlaying(!playing)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-700 text-ink-300 transition-colors hover:bg-ink-850 hover:text-ink-100"
          aria-label={playing ? "Pausar" : "Reproduzir"}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => {
              setStep(i);
              setPlaying(false);
            }}
            className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors ${i === step ? "bg-ink-850 font-medium text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
          >
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${i === step ? "bg-accent text-white" : "bg-ink-850 text-ink-400"}`}>{i + 1}</span>
            {s.title}
          </button>
        ))}
      </div>
      <motion.p key={`text-${step}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 min-h-[40px] text-[13px] leading-relaxed text-ink-300">
        {current.text}
      </motion.p>
      <p className="text-[11.5px] text-ink-500">Nos servidores conectados pela API da Anthropic, a própria API faz o papel do cliente MCP nas etapas 1, 2, 4 e 5.</p>
    </div>
  );
}

/** Pacote que percorre os trechos da etapa, um depois do outro. */
function Packet({ path }: { path: Path }) {
  const xs = [NODES[path[0][0]].x, ...path.map(([, b]) => NODES[b].x)];
  return (
    <motion.span
      className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_25%,transparent)]"
      style={{ top: `${NODE_Y}%` }}
      initial={{ left: `${xs[0]}%`, opacity: 0 }}
      animate={{ left: xs.map((x) => `${x}%`), opacity: [0, 1, ...Array(Math.max(0, xs.length - 2)).fill(1), 0.9] }}
      transition={{ duration: HOP_S * path.length, ease: "easeInOut", delay: 0.3 }}
    />
  );
}
