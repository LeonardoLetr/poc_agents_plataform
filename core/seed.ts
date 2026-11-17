import type { DB } from "./store.js";
import type { z } from "zod";
import {
  AgentConfig,
  AuditEntry,
  EFFORTS,
  LlmConfig,
  McpServerConfig,
  Memory,
  PromptTemplate,
  RunRecord,
  StoredRunEvent,
} from "./types.js";
import { isRecord, now, uid } from "./util.js";

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
    newLlm({
      id: SEED_LLM.haiku,
      name: "Claude Haiku 5.5 (rápido)",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "low",
      refusalFallback: false,
    }),
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
    marketAgent(researcher.id, analyst.id),
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
    description:
      "Divide tarefas complexas e delega ao Pesquisador e ao Analista de Dados, consolidando as respostas. Usa Claude (requer chave).",
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

const MARKET_PROMPT =
  "Você compara preços de produtos nos encartes (folhetos de ofertas) das grandes redes de supermercado perto do usuário. " +
  "Você coordena dois especialistas: o Pesquisador (busca e lê páginas e PDFs na web) e o Analista de Dados (faz as contas). " +
  "Eles não veem esta conversa: cada delegação precisa trazer todas as informações necessárias.\n\n" +
  "Redes consideradas (edite esta lista conforme a sua cidade): Tauste, Carrefour, Assaí, Atacadão. " +
  "Use só essas redes grandes; ignore mercados pequenos e independentes.\n\n" +
  "Passo a passo:\n" +
  '1. Localização: procure na memória o CEP do usuário (`memory_search` com "CEP endereço do usuário"). ' +
  "Se não houver, pergunte o CEP e pare. Quando o usuário informar, salve com `memory_save` (tipo preference, " +
  'ex.: "CEP do usuário: 18000-000, Sorocaba/SP") e continue.\n' +
  "2. Lojas próximas: procure na memória as lojas de cada rede já identificadas para esse CEP. Se não houver, delegue ao " +
  "Pesquisador: listar a loja de cada rede mais próxima do CEP, na mesma cidade, com endereço e distância aproximada, " +
  "dando preferência às que ficam a até 5 km (amplie para 10 km só se alguma rede não tiver loja nesse raio). " +
  "Salve o resultado com `memory_save` (tipo fact) para não repetir a busca.\n" +
  "3. Encartes: delegue ao Pesquisador uma rede por vez, em paralelo. Peça para encontrar o encarte vigente da rede na " +
  "cidade (ou da loja indicada), ler o PDF ou a página com `web_fetch` e devolver, para cada produto pedido: nome como " +
  "aparece no encarte, preço, unidade (kg, unidade, bandeja), se é preço de clube ou de cartão, validade da oferta e a " +
  'URL do encarte. Produto que não aparecer deve vir como "não encontrado", nunca estimado.\n' +
  "4. Comparação: envie ao Analista de Dados os preços encontrados (com as unidades) e a lista do usuário. Peça para " +
  "converter tudo para a mesma unidade (R$/kg sempre que possível), apontar o mais barato de cada produto e calcular o " +
  "total da lista em cada rede, considerando só os produtos encontrados.\n" +
  "5. Resposta: uma tabela por produto (rede, preço, unidade, validade), a recomendação de onde comprar (uma rede para " +
  "tudo ou dividir entre duas próximas, se a economia compensar a distância) e as fontes com a data. Diga com clareza " +
  "quando um encarte não foi encontrado ou não tinha o produto.\n\n" +
  "Encartes trazem só as promoções da semana: deixe isso claro, porque o preço normal da loja pode ser outro. " +
  "Não faça você mesmo o trabalho dos especialistas. Responda em português.";

/**
 * Comparador de preços por encartes das grandes redes perto do usuário. Pede o CEP uma vez e o guarda na memória;
 * a busca dos encartes vai ao Pesquisador (uma rede por delegação, em paralelo) e as contas ao Analista de Dados.
 */
export function marketAgent(researcherId: string, analystId: string): AgentConfig {
  return baseAgent({
    name: "Comparador de Mercados",
    emoji: "🛒",
    color: "#15803d",
    description:
      "Compara preços nos encartes das grandes redes de supermercado perto do seu CEP, delegando a busca ao Pesquisador e as contas ao Analista. Usa Claude (requer chave).",
    systemPrompt: MARKET_PROMPT,
    tools: [
      `agent__${researcherId}`,
      `agent__${analystId}`,
      "memory_search",
      "memory_save",
      "scratchpad_write",
      "scratchpad_read",
      "current_time",
    ],
    maxIterations: 15,
    // O CEP é buscado de propósito no primeiro passo: o recall automático compara palavras, e "quero comprar frutas" não traz o CEP.
    memory: { autoRecall: true, autoEpisode: true, recallLimit: 3 },
    context: { autoCompact: true, thresholdPct: 60 },
  });
}

/** Instruções da primeira versão do assistente (ligado ao Resend), usadas para atualizar só quem não as editou. */
const EMAIL_PROMPT_V6_START = "Você é um assistente que redige e envia e-mails usando as ferramentas do servidor MCP do Resend.";

const EMAIL_PROMPT =
  "Você é um assistente que redige e envia e-mails usando as ferramentas do servidor MCP de e-mail habilitado para você " +
  "(por exemplo, Gmail pelo Zapier, Brevo ou Resend). Descubra pelas ferramentas disponíveis qual delas envia o e-mail.\n\n" +
  "Regras obrigatórias:\n" +
  "1. Nunca envie um e-mail sem confirmação explícita do usuário nesta conversa. Primeiro mostre o rascunho completo: " +
  "destinatário(s), assunto e corpo (e o remetente, se a ferramenta permitir escolher). Termine perguntando se pode enviar e pare.\n" +
  '2. Só chame a ferramenta de envio depois que o usuário responder confirmando (por exemplo, "pode enviar"). ' +
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
    description:
      "Redige e envia e-mails pelo servidor MCP de e-mail habilitado, sempre mostrando o rascunho e pedindo confirmação antes de enviar. Usa Claude (requer chave).",
    systemPrompt: EMAIL_PROMPT,
    tools: [`mcp__${server}__*`, "current_time"],
    maxIterations: 6,
    memory: { autoRecall: false, autoEpisode: false, recallLimit: 3 },
  });
}

/** Coordenador de exemplo: delega ao agente demo, para o multiagente funcionar sem chave de API. */
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
    m(
      "Um agente autônomo é um loop: o LLM decide, chama ferramentas, observa o resultado e repete até concluir.",
      "fact",
      ["agentes", "conceito"],
      4,
    ),
    m(
      "MCP (Model Context Protocol) padroniza como agentes descobrem e chamam ferramentas de servidores externos.",
      "fact",
      ["mcp", "conceito"],
      4,
    ),
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

/**
 * Atalhos de tarefa do Playground, por agente de exemplo (pelo nome). `{{variável}}` vira um campo a preencher antes
 * de usar o texto.
 */
const TASK_PROMPTS: { agents: string[]; name: string; description: string; content: string }[] = [
  {
    agents: ["Agente Demo (offline)", "Coordenador (offline)"],
    name: "Conta e horário",
    description: "Calculadora e relógio no mesmo pedido.",
    content: "Quanto é (1250 * 1.08) ^ 2 e que horas são agora?",
  },
  {
    agents: ["Agente Demo (offline)"],
    name: "Guardar uma preferência",
    description: "Salva uma preferência na memória de longo prazo.",
    content: "Lembre que eu prefiro {{preferencia}}",
  },
  {
    agents: ["Agente Demo (offline)"],
    name: "Dados e nota (MCP)",
    description: "Usa duas ferramentas do servidor MCP de exemplo.",
    content: "Role {{dados}} e adicione a nota: {{nota}}",
  },
  {
    agents: ["Agente Demo (offline)"],
    name: "Resumir uma página",
    description: "Lê uma página pela ferramenta http_fetch.",
    content: "Resuma {{url}}",
  },
  {
    agents: ["Pesquisador"],
    name: "Pesquisar e memorizar",
    description: "Pesquisa com fontes e salva o principal na memória.",
    content: "Pesquise o que é o Model Context Protocol em https://modelcontextprotocol.io e salve o principal na memória",
  },
  {
    agents: ["Analista de Dados"],
    name: "Juros compostos",
    description: "Projeção de investimento mensal, com as contas.",
    content: "Se eu investir R$ {{valor_mensal}} por mês a {{taxa}}% ao mês, quanto terei em {{anos}} anos? Mostre as contas.",
  },
  {
    agents: ["Assistente com Memória"],
    name: "O que você lembra",
    description: "Consulta a memória de longo prazo sobre o usuário.",
    content: "O que você lembra sobre mim?",
  },
  {
    agents: ["Explorador MCP"],
    name: "Converter e rolar dados",
    description: "Duas ferramentas do servidor MCP de exemplo.",
    content: "Converta {{km}} km para milhas e role 3d6 usando o servidor MCP",
  },
  {
    agents: ["Assistente de E-mail"],
    name: "E-mail de teste",
    description: "Rascunho de um e-mail curto, enviado só depois da confirmação.",
    content: 'Escreva um e-mail para {{destinatario}} com o assunto "Teste do Agent Lab" dizendo que o agente de e-mail está funcionando',
  },
  {
    agents: ["Assistente de E-mail"],
    name: "Convite de reunião",
    description: "Convite com assunto, data e participantes.",
    content: "Redija um convite para uma reunião de {{assunto}} {{quando}} para {{destinatarios}}",
  },
  {
    agents: ["Supervisor"],
    name: "Custo de uma viagem",
    description: "Pesquisa de preço com o Pesquisador e contas com o Analista.",
    content:
      "Pesquise o preço médio atual do litro da gasolina no Brasil e calcule quanto custa rodar {{km}} km com um carro que faz {{consumo}} km/l",
  },
  {
    agents: ["Supervisor"],
    name: "Comparar capitais",
    description: "Pesquisa com fontes e cálculo percentual.",
    content:
      "Compare a população das 3 maiores capitais do Brasil e calcule a diferença percentual entre a maior e a menor, citando as fontes",
  },
  {
    agents: ["Comparador de Mercados"],
    name: "Lista de compras",
    description: "Compara os produtos nos encartes das redes perto do seu CEP.",
    content: "Quero comprar {{produtos}}. Onde está mais barato?",
  },
];

/** Prompts de tarefa ligados aos agentes de exemplo que existirem (os demais atalhos ficam de fora). */
function taskPromptsFor(agents: readonly AgentConfig[]): PromptTemplate[] {
  return TASK_PROMPTS.flatMap((t) => {
    const agentIds = agents.filter((a) => t.agents.includes(a.name)).map((a) => a.id);
    return agentIds.length
      ? [
          {
            id: uid("prm"),
            name: t.name,
            description: t.description,
            content: t.content,
            category: "task" as const,
            agentIds,
            createdAt: now(),
          },
        ]
      : [];
  });
}

export function seedPrompts(agents: readonly AgentConfig[]): PromptTemplate[] {
  const p = (name: string, description: string, content: string, category: PromptTemplate["category"]): PromptTemplate => ({
    id: uid("prm"),
    name,
    description,
    content,
    category,
    agentIds: [],
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
    {
      ...p(
        "Tarefa: pesquisa com fontes",
        "Modelo de tarefa para o agente Pesquisador.",
        "Pesquise sobre {{tema}}. Traga 3 fatos principais, cada um com a URL da fonte, e salve o mais importante na memória.",
        "task",
      ),
      agentIds: agents.filter((a) => a.name === "Pesquisador").map((a) => a.id),
    },
    ...taskPromptsFor(agents),
  ];
}

export function seedDb(): DB {
  const agents = seedAgents();
  return {
    version: 11,
    llms: seedLlms(),
    agents,
    memories: seedMemories(),
    mcpServers: seedMcpServers(),
    prompts: seedPrompts(agents),
    audit: [],
    runs: [],
  };
}

/** Servidor MCP de uma ferramenta qualificada (`mcp__<servidor>__<ferramenta>`). */
const serverOfTool = (tool: string) => tool.slice("mcp__".length).split("__")[0] ?? "";

type Raw = Record<string, unknown>;
const rawList = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const rawString = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Valida cada item; os que não servem são descartados com um aviso, sem impedir a carga do resto. */
function parseEach<T>(schema: z.ZodType<T>, items: unknown[], label: string): T[] {
  const out: T[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else console.warn(`Item de ${label} descartado ao carregar os dados:`, parsed.error.issues[0]?.message, item);
  }
  return out;
}

/** Execução salva: eventos que não servem são descartados um a um, sem perder o resto do histórico. */
function parseRun(raw: Raw): unknown {
  return { ...raw, events: parseEach(StoredRunEvent, rawList(raw.events), "eventos de execução") };
}

/**
 * Converte dados salvos (de qualquer versão) para o formato atual, validando cada item.
 * Longa de propósito: as etapas por versão ficam em sequência, na ordem em que os formatos mudaram.
 */
export function migrate(raw: unknown): DB {
  const data = isRecord(raw) ? raw : {};
  const version = typeof data.version === "number" ? data.version : 1;
  const rawLlms = rawList(data.llms);
  const rawAgents = rawList(data.agents);
  // Dados salvos, mas sem nenhum agente nem LLM (armazenamento vazio ou corrompido): começa do conjunto inicial.
  if (!rawAgents.length && !rawLlms.length) return seedDb();
  let rawServers = rawList(data.mcpServers);

  // Etapas sobre campos que o formato atual não tem mais: rodam antes da validação, nos dados brutos.
  if (version < 2) {
    // Versão 2: provedor e modelo saem do agente e viram LLMs separadas.
    const legacyKey = isRecord(data.settings) ? rawString(data.settings.anthropicApiKey) : undefined;
    if (!rawLlms.length)
      rawLlms.push(...seedLlms().map((l) => (l.provider === "anthropic" && legacyKey ? { ...l, apiKey: legacyKey } : l)));
    for (const agent of rawAgents) {
      if (rawString(agent.llmId)) continue;
      if (agent.provider === "demo") {
        agent.llmId = SEED_LLM.demo;
        continue;
      }
      const model = rawString(agent.model) ?? "claude-opus-5-5";
      const effort = EFFORTS.find((e) => e === agent.effort) ?? "medium";
      let llm = rawLlms.find((l) => l.provider === "anthropic" && l.model === model && (l.effort ?? "medium") === effort);
      if (!llm) {
        llm = newLlm({ name: `${model} (${effort})`, provider: "anthropic", model, effort, apiKey: legacyKey });
        rawLlms.push(llm);
      }
      agent.llmId = llm.id;
    }
    // O laboratorio agora é embutido (funciona sem processo externo).
    for (const s of rawServers)
      if (s.name === "laboratorio" && s.transport === "stdio") Object.assign(s, { transport: "builtin", command: "laboratorio", args: [] });
  }
  if (version < 9) {
    // Versão 9: sem servidor local, não há mais transporte stdio. Servidores stdio e suas ferramentas saem dos dados.
    const removed = new Set(rawServers.filter((s) => s.transport === "stdio").map((s) => s.name));
    rawServers = rawServers.filter((s) => !removed.has(s.name));
    for (const a of rawAgents)
      if (Array.isArray(a.tools))
        a.tools = a.tools.filter((t) => typeof t !== "string" || !t.startsWith("mcp__") || !removed.has(serverOfTool(t)));
  }

  // Campos que o formato atual não conhece (provider/model do agente, env dos servidores) são descartados aqui.
  const out: DB = {
    version: 11,
    llms: parseEach(LlmConfig, rawLlms, "LLMs"),
    agents: parseEach(AgentConfig, rawAgents, "agentes"),
    memories: parseEach(Memory, rawList(data.memories), "memórias"),
    mcpServers: parseEach(McpServerConfig, rawServers, "servidores MCP"),
    prompts: parseEach(PromptTemplate, rawList(data.prompts), "prompts"),
    audit: parseEach(AuditEntry, rawList(data.audit), "auditoria"),
    runs: parseEach(RunRecord, rawList(data.runs).map(parseRun), "execuções"),
  };

  if (version < 3) {
    // Versão 3: multiagente. Adiciona o coordenador de exemplo quando o agente demo ainda existe.
    const demo = out.agents.find((a) => a.llmId === SEED_LLM.demo && a.name === "Agente Demo (offline)");
    if (demo && out.llms.some((l) => l.id === SEED_LLM.demo) && !out.agents.some((a) => a.name === "Coordenador (offline)"))
      out.agents.push(coordinatorAgent(demo.id));
  }
  if (version < 4) {
    // Versão 4: gestão de contexto. O agente demo passa a resumir o histórico automaticamente.
    for (const a of out.agents)
      if (a.name === "Agente Demo (offline)" && a.llmId === SEED_LLM.demo && !a.context) a.context = { ...DEMO_CONTEXT };
  }
  if (version < 5) {
    // Versão 5: supervisor com LLM real, quando os especialistas e a LLM Opus de exemplo ainda existem.
    const researcher = out.agents.find((a) => a.name === "Pesquisador");
    const analyst = out.agents.find((a) => a.name === "Analista de Dados");
    if (researcher && analyst && out.llms.some((l) => l.id === SEED_LLM.opus) && !out.agents.some((a) => a.name === "Supervisor")) {
      out.agents.push(supervisorAgent(researcher.id, analyst.id));
    }
  }
  if (version < 6) {
    // Versão 6: assistente de e-mail, ligado ao servidor do Resend já cadastrado (pelo endereço), se houver.
    const resend = out.mcpServers.find((s) => s.url?.includes("mcp.resend.com"));
    if (out.llms.some((l) => l.id === SEED_LLM.opus) && !out.agents.some((a) => a.name === "Assistente de E-mail"))
      out.agents.push(emailAgent(resend?.name));
  }
  if (version < 7) {
    // Versão 7: o assistente de e-mail deixa de ser exclusivo do Resend. Só atualiza instruções e descrição não editadas.
    for (const a of out.agents) {
      if (a.name !== "Assistente de E-mail" || !a.systemPrompt.startsWith(EMAIL_PROMPT_V6_START)) continue;
      a.systemPrompt = EMAIL_PROMPT;
      if (a.description.includes("do Resend")) a.description = emailAgent().description;
    }
  }
  if (version < 8) {
    // Versão 8: remove referências a servidores MCP que já foram apagados (antes a exclusão não limpava os agentes).
    const names = new Set(out.mcpServers.map((s) => s.name));
    for (const a of out.agents) a.tools = a.tools.filter((t) => !t.startsWith("mcp__") || names.has(serverOfTool(t)));
  }
  if (version < 10) {
    // Versão 10: comparador de preços por encartes, quando o Pesquisador, o Analista e a LLM Opus de exemplo ainda existem.
    const researcher = out.agents.find((a) => a.name === "Pesquisador");
    const analyst = out.agents.find((a) => a.name === "Analista de Dados");
    if (
      researcher &&
      analyst &&
      out.llms.some((l) => l.id === SEED_LLM.opus) &&
      !out.agents.some((a) => a.name === "Comparador de Mercados")
    )
      out.agents.push(marketAgent(researcher.id, analyst.id));
  }
  if (version < 11) {
    // Versão 11: os atalhos fixos do Playground viram prompts de tarefa ligados aos agentes de exemplo.
    const names = new Set(out.prompts.map((p) => p.name));
    out.prompts.push(...taskPromptsFor(out.agents).filter((p) => !names.has(p.name)));
    const research = out.prompts.find((p) => p.name === "Tarefa: pesquisa com fontes" && p.agentIds.length === 0);
    const researcher = out.agents.find((a) => a.name === "Pesquisador");
    if (research && researcher) research.agentIds = [researcher.id];
  }
  return out;
}
