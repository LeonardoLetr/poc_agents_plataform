import type { AgentConfig, McpServerConfig, Memory, PromptTemplate } from "./types.js";
import { now, uid } from "./util.js";

const baseAgent = (a: Partial<AgentConfig> & Pick<AgentConfig, "name" | "systemPrompt" | "tools">): AgentConfig => ({
  id: uid("agt"),
  emoji: "🤖",
  color: "#8b5cf6",
  description: "",
  provider: "anthropic",
  model: "claude-opus-5-5",
  effort: "medium",
  maxIterations: 10,
  requireApproval: false,
  memory: { autoRecall: true, autoEpisode: true, recallLimit: 5 },
  refusalFallback: true,
  createdAt: now(),
  updatedAt: now(),
  ...a,
});

export function seedAgents(): AgentConfig[] {
  return [
    baseAgent({
      name: "Pesquisador",
      emoji: "🔎",
      color: "#22d3ee",
      description: "Busca páginas na web, extrai fatos e guarda o que aprendeu na memória.",
      systemPrompt:
        "Você é um pesquisador meticuloso. Planeje antes de agir, use `http_fetch` para obter fontes, " +
        "cite as URLs que usou e salve fatos importantes com `memory_save`. Responda em português.",
      tools: ["http_fetch", "memory_save", "memory_search", "scratchpad_write", "current_time"],
    }),
    baseAgent({
      name: "Analista de Dados",
      emoji: "📊",
      color: "#f59e0b",
      description: "Resolve problemas numéricos passo a passo com a calculadora e anota o raciocínio.",
      systemPrompt:
        "Você é um analista quantitativo. Quebre problemas em etapas, use `calculator` para TODA conta " +
        "(nunca calcule de cabeça) e registre resultados intermediários no `scratchpad_write`. Responda em português.",
      tools: ["calculator", "scratchpad_write", "scratchpad_read", "current_time"],
      effort: "high",
    }),
    baseAgent({
      name: "Assistente com Memória",
      emoji: "🧠",
      color: "#a78bfa",
      description: "Lembra suas preferências entre conversas usando memória de longo prazo.",
      systemPrompt:
        "Você é um assistente pessoal. Antes de responder, procure na memória o que já sabe sobre o usuário " +
        "(`memory_search`). Quando descobrir uma preferência ou fato novo, salve com `memory_save`. Responda em português.",
      tools: ["memory_save", "memory_search", "memory_forget", "current_time"],
    }),
    baseAgent({
      name: "Agente Demo (offline)",
      emoji: "🎬",
      color: "#34d399",
      description: "Roda sem chave de API: um LLM simulado que usa as ferramentas reais para você ver o loop funcionando.",
      provider: "demo",
      model: "demo-simulado",
      systemPrompt: "Você é um agente de demonstração que explica cada passo do loop agêntico.",
      tools: ["calculator", "current_time", "memory_save", "memory_search", "scratchpad_write", "http_fetch", "mcp__laboratorio__*"],
    }),
    baseAgent({
      name: "Explorador MCP",
      emoji: "🔌",
      color: "#f472b6",
      description: "Usa as ferramentas do servidor MCP de exemplo 'laboratorio' (notas, dados, texto, unidades).",
      systemPrompt:
        "Você é um agente que usa ferramentas externas via MCP. Explique qual servidor e ferramenta está usando e por quê. Responda em português.",
      tools: ["mcp__laboratorio__*", "calculator"],
    }),
  ];
}

export function seedMemories(): Memory[] {
  const m = (content: string, kind: Memory["kind"], tags: string[], importance = 3): Memory => ({
    id: uid("mem"),
    agentId: null,
    kind,
    content,
    tags,
    importance,
    accessCount: 0,
    createdAt: now(),
    lastAccessedAt: null,
    source: "user",
  });
  return [
    m("O usuário prefere respostas em português, objetivas e com exemplos práticos.", "preference", ["usuário", "estilo"], 5),
    m("Um agente autônomo é um loop: o LLM decide, chama ferramentas, observa o resultado e repete até concluir.", "fact", ["agentes", "conceito"], 4),
    m("MCP (Model Context Protocol) padroniza como agentes descobrem e chamam ferramentas de servidores externos.", "fact", ["mcp", "conceito"], 4),
    m("Para cálculos, sempre usar a ferramenta calculator em vez de calcular mentalmente.", "procedure", ["cálculo", "boas práticas"], 3),
  ];
}

export function seedMcpServers(): McpServerConfig[] {
  return [
    {
      // Servidor de exemplo incluído no repositório (mcp-servers/laboratorio).
      id: uid("mcp"),
      name: "laboratorio",
      transport: "stdio",
      command: "node",
      args: ["--import", "tsx", "../mcp-servers/laboratorio/index.ts"],
      env: {},
      enabled: true,
      createdAt: now(),
    },
    {
      id: uid("mcp"),
      name: "everything",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      env: {},
      enabled: false,
      createdAt: now(),
    },
  ];
}

export function seedPrompts(): PromptTemplate[] {
  const p = (name: string, description: string, content: string, category: PromptTemplate["category"]): PromptTemplate => ({
    id: uid("prm"),
    name,
    description,
    content,
    category,
    createdAt: now(),
  });
  return [
    p(
      "ReAct (Raciocinar + Agir)",
      "Força o padrão pensar → agir → observar a cada passo.",
      "Trabalhe em ciclos. Em cada ciclo: (1) explique brevemente o que vai fazer e por quê, (2) chame UMA ferramenta, " +
        "(3) analise o resultado. Quando tiver informação suficiente, dê a resposta final começando com 'RESPOSTA:'.",
      "system",
    ),
    p(
      "Planejador",
      "Cria um plano numerado antes de executar.",
      "Antes de usar qualquer ferramenta, escreva um plano numerado no scratchpad (`scratchpad_write`). " +
        "Execute o plano item a item e atualize o scratchpad marcando o que concluiu.",
      "system",
    ),
    p(
      "Crítico interno",
      "O agente revisa a própria resposta antes de entregar.",
      "Antes da resposta final, revise criticamente: há erros? suposições não verificadas? Corrija o que for necessário.",
      "system",
    ),
    p(
      "Tarefa: pesquisa com fontes",
      "Modelo de tarefa para o agente Pesquisador.",
      "Pesquise sobre {{tema}}. Traga 3 fatos principais, cada um com a URL da fonte, e salve o mais importante na memória.",
      "task",
    ),
  ];
}
