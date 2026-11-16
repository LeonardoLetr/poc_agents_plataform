import { Background, BackgroundVariant, BaseEdge, Handle, Position, ReactFlow, getBezierPath, useEdgesState, useNodesState, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Brain, Calculator, Clock, Globe, NotebookPen, Plug, User, Wrench } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { Agent, ToolInfo } from "../lib/api";
import { graphTarget, type RunView } from "../lib/runState";

/**
 * Grafo ao vivo do agente: mostra o LLM no centro, a memória, o scratchpad e
 * cada ferramenta/servidor MCP. As arestas "acendem" com um feixe animado
 * quando a informação flui (pedido → ferramenta, resultado → LLM).
 */

type Flow = "out" | "back" | null;

const ICONS: Record<string, typeof Wrench> = {
  calculator: Calculator,
  current_time: Clock,
  http_fetch: Globe,
};

const handles = (
  <>
    <Handle type="target" position={Position.Left} id="l" />
    <Handle type="source" position={Position.Right} id="r" />
    <Handle type="source" position={Position.Bottom} id="b" />
    <Handle type="target" position={Position.Top} id="t" />
    <Handle type="source" position={Position.Top} id="ts" />
    <Handle type="target" position={Position.Bottom} id="bt" />
  </>
);

function AgentNode({ data }: NodeProps<Node<{ agent: Agent; view: RunView; llmLabel: string }>>) {
  const { agent, view, llmLabel } = data;
  const thinking = view.active === "llm" && (view.status === "running");
  const label =
    view.status === "idle" ? "Aguardando tarefa" :
    view.status === "completed" ? "Tarefa concluída" :
    view.status === "failed" ? "Falhou" :
    view.status === "cancelled" ? "Cancelado" :
    view.status === "awaiting_approval" ? "Aguardando aprovação" :
    thinking ? "Pensando…" : "Usando ferramentas";
  return (
    <div className="relative flex w-[210px] flex-col items-center">
      {handles}
      <div className="relative h-[92px] w-[92px]">
        {/* Anel fino girando enquanto o LLM pensa — o único movimento contínuo do grafo. */}
        {thinking && (
          <svg className="absolute -inset-[5px] h-[102px] w-[102px] animate-spin-slow" viewBox="0 0 102 102" aria-hidden>
            <circle cx="51" cy="51" r="49" fill="none" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="70 238" />
          </svg>
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-full border border-ink-700 bg-surface text-[38px] shadow-[0_1px_3px_rgb(31_30_28/0.08)]">
          {agent.emoji}
        </div>
        {view.iteration > 0 && (
          <div className="absolute -right-1 -top-1 rounded-full border border-ink-700 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-300">#{view.iteration}</div>
        )}
      </div>
      <div className="mt-2 text-center">
        <div className="text-[13px] font-semibold">{agent.name}</div>
        <div className="font-mono text-[10px] text-ink-400">{view.model ?? llmLabel}</div>
        <div className={`mt-1 text-[11px] ${thinking ? "shimmer-text" : "text-ink-300"}`}>{label}</div>
      </div>
    </div>
  );
}

function ToolNode({ data }: NodeProps<Node<{ label: string; sub?: string; icon: typeof Wrench; active: boolean; count: number; color: string; dim?: boolean }>>) {
  const Icon = data.icon;
  return (
    <div className="relative">
      {handles}
      <motion.div
        animate={{ scale: data.active ? 1.03 : 1 }}
        className={`flex min-w-[150px] items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-2 transition-colors ${data.dim ? "opacity-50" : ""}`}
        style={{
          borderColor: data.active ? data.color : "var(--color-ink-700)",
          background: data.active ? `color-mix(in oklab, ${data.color} 7%, var(--color-surface))` : "var(--color-surface)",
          boxShadow: data.active ? `0 0 0 3px color-mix(in oklab, ${data.color} 14%, transparent)` : "0 1px 2px rgb(0 0 0 / 0.05)",
        }}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: `color-mix(in oklab, ${data.color} 12%, var(--color-surface))`, color: data.color }}>
          <Icon size={14} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-ink-100">{data.label}</div>
          {data.sub && <div className="truncate font-mono text-[9.5px] text-ink-400">{data.sub}</div>}
        </div>
        {data.count > 0 && (
          <motion.span key={data.count} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="ml-auto rounded-full bg-ink-900 px-1.5 font-mono text-[10px] text-ink-300">
            {data.count}×
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}

function BeamEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<{ flow: Flow; color: string }>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const flow = data?.flow ?? null;
  const color = data?.color ?? "#2563eb";
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: flow ? color : "var(--color-ink-600)", strokeWidth: flow ? 1.6 : 1.1, transition: "all .3s" }} />
      {flow && (
        <>
          {[0, 0.45].map((offset) => (
            <circle key={offset} r={3} fill={color}>
              <animateMotion dur="1.1s" repeatCount="indefinite" path={path} begin={`${offset}s`} keyPoints={flow === "back" ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
            </circle>
          ))}
        </>
      )}
    </>
  );
}

const nodeTypes = { agent: AgentNode, tool: ToolNode };
const edgeTypes = { beam: BeamEdge };

export function AgentGraph(props: { agent: Agent; tools: ToolInfo[]; view: RunView; llmLabel: string }) {
  // Remonta (e reenquadra) quando troca de agente ou o conjunto de ferramentas muda.
  return <GraphInner key={`${props.agent.id}:${props.agent.tools.join(",")}:${props.tools.length}`} {...props} />;
}

function GraphInner({ agent, tools, view, llmLabel }: { agent: Agent; tools: ToolInfo[]; view: RunView; llmLabel: string }) {
  // O texto transmitido muda a cada token; o grafo só precisa mudar quando o "estado visível" muda.
  const iterations = view.steps.filter((s) => s.kind === "iteration");
  const signature = JSON.stringify({
    a: view.active,
    s: view.status,
    c: view.callCounts,
    i: view.iteration,
    m: view.model,
    it: iterations.slice(-2).map((it) => (it.kind === "iteration" ? [it.phase, it.tools.map((t) => t.status)] : null)),
  });

  const computed = useMemo(() => {
    // Quais nós existem: ferramentas nativas (exceto memória/scratchpad), servidores MCP, memória e scratchpad.
    const builtin = agent.tools.filter((t) => !t.startsWith("mcp__") && !t.startsWith("memory_") && !t.startsWith("scratchpad_"));
    const mcpServers = new Set<string>();
    for (const t of agent.tools) {
      const m = t.match(/^mcp__(.+?)__/);
      if (m) mcpServers.add(m[1]);
    }
    const hasMemory = agent.tools.some((t) => t.startsWith("memory_")) || agent.memory.autoRecall || agent.memory.autoEpisode;
    const hasScratch = agent.tools.some((t) => t.startsWith("scratchpad_"));

    // Fluxo atual: para onde a informação está indo.
    const last = [...view.steps].reverse().find((s) => s.kind === "iteration");
    const flows = new Map<string, Flow>();
    if (view.status === "running" || view.status === "awaiting_approval") {
      if (last && last.kind === "iteration") {
        if (last.phase === "tools") {
          for (const t of last.tools) if (t.status === "running" || t.status === "awaiting_approval") flows.set(graphTarget(t.name, t.server), "out");
        } else if (last.phase === "llm") {
          const prev = [...view.steps].reverse().filter((s) => s.kind === "iteration")[1];
          if (prev && prev.kind === "iteration" && prev.tools.length) for (const t of prev.tools) flows.set(graphTarget(t.name, t.server), "back");
          else flows.set("user", "out");
        }
      } else flows.set("user", "out");
      if (view.active === "memory") flows.set("memory", flows.get("memory") ?? "back");
    }
    if (view.status === "completed") flows.set("user", "back");

    const toolNodes: { id: string; label: string; sub?: string; icon: typeof Wrench; color: string; dim?: boolean }[] = [
      ...builtin.map((t) => ({ id: `tool:${t}`, label: t, sub: "ferramenta nativa", icon: ICONS[t] ?? Wrench, color: "#d97706" })),
      ...[...mcpServers].map((s) => {
        const available = tools.filter((t) => t.server === s).length;
        return { id: `mcp:${s}`, label: s, sub: available ? `MCP · ${available} ferramentas` : "MCP · desconectado", icon: Plug, color: "#ea580c", dim: !available };
      }),
    ];

    const gap = 78;
    const startY = 150 - ((toolNodes.length - 1) * gap) / 2;
    const nodes: Node[] = [
      { id: "user", type: "tool", position: { x: 0, y: 130 }, data: { label: "Usuário", sub: "tarefa / resposta", icon: User, active: view.active === "user", count: 0, color: "#0284c7" } },
      { id: "llm", type: "agent", position: { x: 250, y: 80 }, data: { agent, view, llmLabel } },
      ...toolNodes.map((t, i) => ({
        id: t.id,
        type: "tool",
        position: { x: 590, y: startY + i * gap },
        data: { ...t, active: view.active === t.id, count: view.callCounts[t.id] ?? 0 },
      })),
    ];
    if (hasMemory) nodes.push({ id: "memory", type: "tool", position: { x: 280, y: 330 }, data: { label: "Memória longo prazo", sub: "fatos · episódios", icon: Brain, active: view.active === "memory", count: view.callCounts.memory ?? 0, color: "#7c3aed" } });
    if (hasScratch) nodes.push({ id: "scratchpad", type: "tool", position: { x: 280, y: -70 }, data: { label: "Scratchpad", sub: "memória de trabalho", icon: NotebookPen, active: view.active === "scratchpad", count: view.callCounts.scratchpad ?? 0, color: "#16a34a" } });

    const edge = (id: string, source: string, target: string, sh: string, th: string, color: string): Edge => ({
      id,
      source,
      target,
      sourceHandle: sh,
      targetHandle: th,
      type: "beam",
      data: { flow: flows.get(id === "e-user" ? "user" : target === "llm" ? source : target) ?? null, color },
    });
    const edges: Edge[] = [edge("e-user", "user", "llm", "r", "l", "#0284c7")];
    for (const t of toolNodes) edges.push(edge(`e-${t.id}`, "llm", t.id, "r", "l", t.color));
    if (hasMemory) edges.push(edge("e-memory", "llm", "memory", "b", "t", "#7c3aed"));
    if (hasScratch) edges.push(edge("e-scratch", "llm", "scratchpad", "ts", "bt", "#16a34a"));
    return { nodes, edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, tools, signature, llmLabel]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(computed.nodes);
  const [edges, setEdges] = useEdgesState<Edge>(computed.edges);
  useEffect(() => {
    // Atualiza só os dados, preservando posição e medidas já calculadas (e o que o usuário arrastou).
    setNodes((prev) => computed.nodes.map((n) => {
      const old = prev.find((p) => p.id === n.id);
      return old ? { ...old, data: n.data } : n;
    }));
    setEdges(computed.edges);
  }, [computed, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      panOnScroll={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.4}
      maxZoom={1.4}
    >
      {/* Pontilhado discreto: dá referência espacial sem competir com os nós. */}
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-ink-700)" />
    </ReactFlow>
  );
}
