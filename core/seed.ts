import type { DB } from "./store.js";
import type { AgentConfig, LlmConfig, McpServerConfig, Memory, PromptTemplate } from "./types.js";
import { now, uid } from "./util.js";

export const newLlm = (l: Partial<LlmConfig> & Pick<LlmConfig, "name" | "provider" | "model">): LlmConfig => ({
  id: uid("llm"),
  effort: "medium",
  refusalFallback: true,
  maxTokens: l.provider === "openai" ? 4096 : 64000,
  createdAt: now(),
  updatedAt: now(),
  ...l,
});

/** IDs fixos para as LLMs de exemplo, para os agentes de exemplo poderem referenciá-las. */
export const SEED_LLM = { opus: "llm_claude_opus", haiku: "llm_claude_haiku", demo: "llm_demo" };

export function seedLlms(): LlmConfig[] {
  return [
    newLlm({ id: SEED_LLM.opus, name: "Claude Opus 5.5", provider: "anthropic", model: "claude-opus-5-5", effort: "medium" }),
    newLlm({ id: SEED_LLM.haiku, name: "Claude Haiku 5.5 (rápido)", provider: "anthropic", model: "claude-haiku-5-5", effort: "low", refusalFallback: false }),
    newLlm({ id: SEED_LLM.demo, name: "Demo (offline)", provider: "demo", model: "demo-simulado" }),
  ];
}

const baseAgent = (a: Partial<AgentConfig> & Pick<AgentConfig, "name" | "systemPrompt" | "tools">): AgentConfig => ({
  id: uid("agt"),
  emoji: "🤖",
  color: "#2563eb",
  description: "",
  llmId: SEED_LLM.opus,
  maxIterations: 10,
  requireApproval: false,
  memory: { autoRecall: true, autoEpisode: true, recallLimit: 5 },
  createdAt: now(),
  updatedAt: now(),
  ...a,
});

export function seedAgents(): AgentConfig[] {
  const demo = demoAgent();
  const researcher = baseAgent({
      name: "Pesquisador",
      emoji: "🔎",
      color: "#0284c7",
      description: "Busca páginas na web, extrai fatos e guarda o que aprendeu na memória.",
      systemPrompt:
        "Você é um pesquisador meticuloso. Planeje antes de agir, use `web_search` para encontrar fontes e " +
        "`web_fetch` para lê-las (ou `http_fetch` quando a LLM não for da Anthropic), cite as URLs que usou " +
        "e salve fatos importantes com `memory_save`. Responda em português.",
      tools: ["web_search", "web_fetch", "http_fetch", "memory_save", "memory_search", "scratchpad_write", "current_time"],
    });
  const analyst = baseAgent({
      name: "Analista de Dados",
      emoji: "📊",
      color: "#d97706",
      description: "Resolve problemas numéricos passo a passo com a calculadora e anota o raciocínio.",
      systemPrompt:
        "Você é um analista quantitativo. Quebre problemas em etapas, use `calculator` para TODA conta " +
        "(nunca calcule de cabeça) e registre resultados intermediários no `scratchpad_write`. Responda em português.",
      tools: ["calculator", "scratchpad_write", "scratchpad_read", "current_time"],
    });
  return [
    researcher,
    analyst,
    supervisorAgent(researcher.id, analyst.id),
    baseAgent({
      name: "Assistente com Memória",
      emoji: "🧠",
      color: "#7c3aed",
      description: "Lembra suas preferências entre conversas usando memória de longo prazo.",
      systemPrompt:
        "Você é um assistente pessoal. Antes de responder, procure na memória o que já sabe sobre o usuário " +
        "(`memory_search`). Quando descobrir uma preferência ou fato novo, salve com `memory_save`. Responda em português.",
      tools: ["memory_save", "memory_search", "memory_forget", "current_time"],
    }),
    baseAgent({
      name: "Explorador MCP",
      emoji: "🔌",
      color: "#ea580c",
      description: "Usa as ferramentas do servidor MCP de exemplo 'laboratorio' (notas, dados, texto, unidades).",
      systemPrompt:
        "Você é um agente que usa ferramentas externas via MCP. Explique qual servidor e ferramenta está usando e por quê. Responda em português.",
      tools: ["mcp__laboratorio__*", "calculator"],
      llmId: SEED_LLM.haiku,
    }),
    demo,
    coordinatorAgent(demo.id),
    emailAgent(),
  ];
}

function demoAgent(): AgentConfig {
  return baseAgent({
    name: "Agente Demo (offline)",
    emoji: "🎬",
    color: "#16a34a",
    description: "Roda sem chave de API: um LLM simulado que usa as ferramentas reais para você ver o loop funcionando.",
    llmId: SEED_LLM.demo,
    systemPrompt: "Você é um agente de demonstração que explica cada passo do loop agêntico.",
    tools: ["calculator", "current_time", "memory_save", "memory_search", "scratchpad_write", "http_fetch", "mcp__laboratorio__*"],
    // Janela simulada pequena (4 mil tokens): ao continuar a conversa algumas vezes, o resumo automático aparece.
    context: DEMO_CONTEXT,
  });
}

const DEMO_CONTEXT = { autoCompact: true, thresholdPct: 50 };

/**
 * Supervisor com LLM real (Claude): divide a tarefa e delega ao Pesquisador e ao Analista de Dados.
 * Precisa de chave de API, assim como os agentes para os quais delega.
 */
export function supervisorAgent(researcherId: string, analystId: string): AgentConfig {
  return baseAgent({
    name: "Supervisor",
    emoji: "🎯",
    color: "#be185d",
    description: "Divide tarefas complexas e delega ao Pesquisador e ao Analista de Dados, consolidando as respostas. Usa Claude (requer chave).",
    systemPrompt:
      "Você é um supervisor que coordena uma equipe de agentes especialistas. Para cada tarefa:\n" +
      "1. Planeje: identifique as subtarefas e registre o plano com `scratchpad_write`.\n" +
      "2. Delegue cada subtarefa ao especialista adequado, com instruções completas e autocontidas " +
      "(eles não veem esta conversa): pesquisa na web e fontes vão para o Pesquisador; contas, " +
      "comparações numéricas e projeções vão para o Analista de Dados. Delegue em paralelo quando as subtarefas forem independentes.\n" +
      "3. Verifique as respostas: se algo estiver incompleto ou contraditório, delegue um ajuste específico.\n" +
      "4. Consolide uma resposta final clara, indicando o que veio de cada especialista e citando as fontes.\n" +
      "Não faça você mesmo o trabalho dos especialistas. Responda em português.",
    tools: [`agent__${researcherId}`, `agent__${analystId}`, "scratchpad_write", "scratchpad_read"],
    maxIterations: 12,
    memory: { autoRecall: true, autoEpisode: true, recallLimit: 3 },
    context: { autoCompact: true, thresholdPct: 60 },
  });
}

/** Supervisor de exemplo: delega ao agente demo, para o multiagente funcionar sem chave de API. */
/** Instruções da primeira versão do assistente (ligado ao Resend), usadas para atualizar só quem não as editou. */
const EMAIL_PROMPT_V6_START = "Você é um assistente que redige e envia e-mails usando as ferramentas do servidor MCP do Resend.";

const EMAIL_PROMPT =
  "Você é um assistente que redige e envia e-mails usando as ferramentas do servidor MCP de e-mail habilitado para você " +
  "(por exemplo, Gmail pelo Zapier, Brevo ou Resend). Descubra pelas ferramentas disponíveis qual delas envia o e-mail.\n\n" +
  "Regras obrigatórias:\n" +
  "1. Nunca envie um e-mail sem confirmação explícita do usuário nesta conversa. Primeiro mostre o rascunho completo: " +
  "destinatário(s), assunto e corpo (e o remetente, se a ferramenta permitir escolher). Termine perguntando se pode enviar e pare.\n" +
  "2. Só chame a ferramenta de envio depois que o usuário responder confirmando (por exemplo, \"pode enviar\"). " +
  "Se ele pedir ajustes, mostre o novo rascunho e peça confirmação de novo.\n" +
  "3. Se faltar o destinatário ou o assunto, pergunte antes de redigir. Não invente endereços.\n" +
  "4. Prefira ferramentas que enviem de fato. Se a ferramenta disponível só criar rascunhos, diga isso ao usuário.\n" +
  "5. Depois de enviar, informe o resultado devolvido pela ferramenta (por exemplo, o id do envio). Se der erro, explique em linguagem simples " +
  "(como conta não conectada, limite do plano gratuito atingido ou remetente não verificado).\n\n" +
  "Escreva os e-mails em português, com tom profissional e cordial, a menos que o usuário peça outro tom.";

/**
 * Assistente de e-mail que usa o servidor MCP de e-mail escolhido no editor do agente (Gmail pelo Zapier, Brevo, Resend...).
 * Enviar e-mail é uma ação externa e irreversível. Ferramentas executadas pela Anthropic não passam pela aprovação
 * humana da plataforma, então a confirmação fica nas instruções: rascunho primeiro, envio só após o "pode enviar".
 */
export function emailAgent(server = "resend"): AgentConfig {
  return baseAgent({
    name: "Assistente de E-mail",
    emoji: "✉️",
    color: "#0f766e",
    description: "Redige e envia e-mails pelo servidor MCP de e-mail habilitado, sempre mostrando o rascunho e pedindo confirmação antes de enviar. Usa Claude (requer chave).",
    systemPrompt: EMAIL_PROMPT,
    tools: [`mcp__${server}__*`, "current_time"],
    maxIterations: 6,
    memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
  });
}

export function coordinatorAgent(demoId: string): AgentConfig {
  return baseAgent({
    name: "Coordenador (offline)",
    emoji: "🧭",
    color: "#7c3aed",
    description: "Supervisor que divide a tarefa e delega a outros agentes. Roda sem chave de API.",
    llmId: SEED_LLM.demo,
    systemPrompt:
      "Você é um coordenador. Divida a tarefa em subtarefas, delegue cada uma ao agente mais adequado e " +
      "consolide as respostas em uma resposta final. Responda em português.",
    tools: [`agent__${demoId}`, "scratchpad_write"],
    memory: { autoRecall: false, autoEpisode: false, recallLimit: 5 },
  });
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
  const servers: McpServerConfig[] = [
    {
      // Servidor de exemplo embutido (core/mcp/lab-server.ts) — roda em memória, até no navegador.
      id: uid("mcp"),
      name: "laboratorio",
      transport: "builtin",
      command: "laboratorio",
      args: [],
      enabled: true,
      createdAt: now(),
    },
  ];
  return servers;
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

export function seedDb(): DB {
  return {
    version: 9,
    llms: seedLlms(),
    agents: seedAgents(),
    memories: seedMemories(),
    mcpServers: seedMcpServers(),
    prompts: seedPrompts(),
    audit: [],
    runs: [],
  };
}

/** Converte dados da versão 1 (provedor/modelo dentro do agente) para LLMs separadas. */
/** Servidor MCP de uma ferramenta qualificada (`mcp__<servidor>__<ferramenta>`). */
const serverOfTool = (tool: string) => tool.slice("mcp__".length).split("__")[0] ?? "";

export function migrate(raw: Record<string, unknown>): DB {
  const data = raw as Partial<DB> & { settings?: { anthropicApiKey?: string }; version?: number };
  // Dados salvos, mas sem nenhum agente nem LLM (armazenamento vazio ou corrompido): começa do conjunto inicial.
  if (!data.agents?.length && !data.llms?.length) return seedDb();
  const out: DB = {
    version: 9,
    llms: data.llms ?? [],
    agents: data.agents ?? [],
    memories: data.memories ?? [],
    mcpServers: data.mcpServers ?? [],
    prompts: data.prompts ?? [],
    audit: data.audit ?? [],
    runs: data.runs ?? [],
  };
  if ((data.version ?? 1) < 2) {
    const legacyKey = data.settings?.anthropicApiKey;
    if (!out.llms.length) out.llms = seedLlms().map((l) => (l.provider === "anthropic" && legacyKey ? { ...l, apiKey: legacyKey } : l));
    for (const agent of out.agents as (AgentConfig & { provider?: string; model?: string; effort?: LlmConfig["effort"] })[]) {
      if (agent.llmId) continue;
      if (agent.provider === "demo") agent.llmId = SEED_LLM.demo;
      else {
        let llm = out.llms.find((l) => l.provider === "anthropic" && l.model === agent.model && l.effort === (agent.effort ?? "medium"));
        if (!llm) {
          llm = newLlm({ name: `${agent.model} (${agent.effort})`, provider: "anthropic", model: agent.model ?? "claude-opus-5-5", effort: agent.effort ?? "medium", apiKey: legacyKey });
          out.llms.push(llm);
        }
        agent.llmId = llm.id;
      }
      delete agent.provider;
      delete agent.model;
      delete agent.effort;
    }
    // O laboratorio agora é embutido (funciona sem processo externo).
    for (const s of out.mcpServers) if (s.name === "laboratorio" && (s.transport as string) === "stdio") Object.assign(s, { transport: "builtin", command: "laboratorio", args: [] });
  }
  if ((data.version ?? 1) < 3) {
    // Versão 3: multiagente. Adiciona o coordenador de exemplo quando o agente demo ainda existe.
    const demo = out.agents.find((a) => a.llmId === SEED_LLM.demo && a.name === "Agente Demo (offline)");
    if (demo && out.llms.some((l) => l.id === SEED_LLM.demo) && !out.agents.some((a) => a.name === "Coordenador (offline)")) out.agents.push(coordinatorAgent(demo.id));
  }
  if ((data.version ?? 1) < 4) {
    // Versão 4: gestão de contexto. O agente demo passa a resumir o histórico automaticamente.
    for (const a of out.agents) if (a.name === "Agente Demo (offline)" && a.llmId === SEED_LLM.demo && !a.context) a.context = { ...DEMO_CONTEXT };
  }
  if ((data.version ?? 1) < 5) {
    // Versão 5: supervisor com LLM real, quando os especialistas e a LLM Opus de exemplo ainda existem.
    const researcher = out.agents.find((a) => a.name === "Pesquisador");
    const analyst = out.agents.find((a) => a.name === "Analista de Dados");
    if (researcher && analyst && out.llms.some((l) => l.id === SEED_LLM.opus) && !out.agents.some((a) => a.name === "Supervisor")) {
      out.agents.push(supervisorAgent(researcher.id, analyst.id));
    }
  }
  if ((data.version ?? 1) < 6) {
    // Versão 6: assistente de e-mail, ligado ao servidor do Resend já cadastrado (pelo endereço), se houver.
    const resend = out.mcpServers.find((s) => s.url?.includes("mcp.resend.com"));
    if (out.llms.some((l) => l.id === SEED_LLM.opus) && !out.agents.some((a) => a.name === "Assistente de E-mail")) out.agents.push(emailAgent(resend?.name));
  }
  if ((data.version ?? 1) < 7) {
    // Versão 7: o assistente de e-mail deixa de ser exclusivo do Resend. Só atualiza instruções e descrição não editadas.
    for (const a of out.agents) {
      if (a.name !== "Assistente de E-mail" || !a.systemPrompt.startsWith(EMAIL_PROMPT_V6_START)) continue;
      a.systemPrompt = EMAIL_PROMPT;
      if (a.description.includes("do Resend")) a.description = emailAgent().description;
    }
  }
  if ((data.version ?? 1) < 8) {
    // Versão 8: remove referências a servidores MCP que já foram apagados (antes a exclusão não limpava os agentes).
    const names = new Set(out.mcpServers.map((s) => s.name));
    for (const a of out.agents) a.tools = a.tools.filter((t) => !t.startsWith("mcp__") || names.has(serverOfTool(t)));
  }
  if ((data.version ?? 1) < 9) {
    // Versão 9: sem servidor local, não há mais transporte stdio. Servidores stdio e suas ferramentas saem dos dados.
    const legacy = out.mcpServers as unknown as { name: string; transport: string }[];
    const removed = new Set(legacy.filter((s) => s.transport === "stdio").map((s) => s.name));
    out.mcpServers = out.mcpServers.filter((s) => !removed.has(s.name));
    for (const s of out.mcpServers as (McpServerConfig & { env?: unknown })[]) delete s.env;
    for (const a of out.agents) a.tools = a.tools.filter((t) => !t.startsWith("mcp__") || !removed.has(serverOfTool(t)));
  }
  return out;
}
