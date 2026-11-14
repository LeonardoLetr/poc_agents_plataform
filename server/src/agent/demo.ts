import type Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig, RunEvent, RunRecord } from "../types.js";
import type { AssistantTurn } from "./runner.js";

/**
 * "LLM" simulado para o modo demonstração. Não é inteligente: segue um plano
 * baseado em palavras-chave da tarefa. Mas ele produz EXATAMENTE o mesmo
 * formato de resposta que a API real (blocos thinking / text / tool_use) e as
 * ferramentas executadas são reais — então o loop agêntico, a memória e a
 * auditoria funcionam de verdade, sem precisar de chave de API.
 */

interface Step {
  thinking: string;
  say: string;
  tool?: { name: string; input: Record<string, unknown> };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("cancelado", "AbortError"));
    }, { once: true });
  });

async function streamText(text: string, type: "text.delta" | "thinking.delta", emit: (ev: RunEvent) => void, signal: AbortSignal) {
  const tokens = text.match(/\S+\s*/g) ?? [];
  for (const tok of tokens) {
    emit({ type, text: tok });
    await sleep(type === "thinking.delta" ? 18 : 28, signal);
  }
}

function extractMath(text: string): string | null {
  let t = text.toLowerCase();
  t = t.replace(/raiz (quadrada )?de (\d+(?:[.,]\d+)?)/g, "sqrt($2)");
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%\s*de\s*(\d+(?:[.,]\d+)?)/g, "($2*$1/100)");
  t = t.replace(/(\d),(\d)/g, "$1.$2").replace(/\bvezes\b|\bx\b|×/g, "*").replace(/\bmais\b/g, "+").replace(/\bmenos\b/g, "-").replace(/\bdividido por\b|÷/g, "/").replace(/\belevado a\b/g, "^");
  const candidates = t.match(/[\d.\s+\-*/^()%a-z]*\d[\d.\s+\-*/^()%a-z]*/g) ?? [];
  const best = candidates
    .map((c) => c.replace(/[a-z]+(?!\()/g, (w) => (["sqrt", "pi"].includes(w) ? w : "")).trim())
    .filter((c) => /\d/.test(c) && /[+\-*/^]|sqrt/.test(c))
    .sort((a, b) => b.length - a.length)[0];
  return best ? best.replace(/^[^\d(s]+|[^\d)]+$/g, "") : null;
}

function plan(input: string, tools: string[]): Step[] {
  // tools: nomes das ferramentas habilitadas e disponíveis
  const has = (n: string) => tools.includes(n);
  const lower = input.toLowerCase();
  const steps: Step[] = [];
  const keywords = input.split(/\s+/).filter((w) => w.length > 3).slice(0, 6).join(" ");

  if (has("scratchpad_write")) {
    steps.push({
      thinking: "Primeiro vou registrar um plano na memória de trabalho. Isso me ajuda a não me perder entre iterações.",
      say: "Vou anotar meu plano no scratchpad antes de agir.",
      tool: { name: "scratchpad_write", input: { note: `Plano para: "${input.slice(0, 120)}" → 1) consultar memória 2) usar ferramentas necessárias 3) responder` } },
    });
  }
  if (has("memory_search")) {
    steps.push({
      thinking: "Antes de qualquer coisa, vale checar se já sei algo sobre isso na memória de longo prazo.",
      say: "Deixa eu verificar o que já está na minha memória sobre o assunto.",
      tool: { name: "memory_search", input: { query: keywords || input } },
    });
  }
  const math = has("calculator") ? extractMath(input) : null;
  if (math) {
    steps.push({
      thinking: `Identifiquei uma conta: "${math}". Não devo calcular de cabeça — vou usar a calculadora para ter precisão.`,
      say: "Vou calcular isso com a ferramenta calculator.",
      tool: { name: "calculator", input: { expression: math } },
    });
  }
  const url = input.match(/https?:\/\/[^\s)]+/)?.[0];
  if (url && has("http_fetch")) {
    steps.push({
      thinking: `A tarefa menciona uma URL (${url}). Preciso buscar o conteúdo para responder com base em fatos.`,
      say: "Vou buscar o conteúdo dessa página.",
      tool: { name: "http_fetch", input: { url } },
    });
  }
  if (/\b(hora|horas|data|hoje|agora|dia)\b/.test(lower) && has("current_time")) {
    steps.push({
      thinking: "A pergunta depende do momento atual — não tenho relógio interno, então uso a ferramenta current_time.",
      say: "Consultando a data e hora atuais.",
      tool: { name: "current_time", input: { timezone: "America/Sao_Paulo" } },
    });
  }
  // Ferramentas vindas de servidores MCP (nome qualificado mcp__servidor__ferramenta)
  const mcpTool = (suffix: string) => tools.find((t) => t.startsWith("mcp__") && t.endsWith(`__${suffix}`));
  const dice = lower.match(/\b(\d{1,2}d\d{1,3})\b/)?.[1] ?? (/(dado|rolar|role)/.test(lower) ? "2d6" : null);
  if (dice && mcpTool("dados_rolar")) {
    steps.push({
      thinking: `Pediram uma rolagem de dados (${dice}). Existe uma ferramenta para isso num servidor MCP externo — vou delegar a ele.`,
      say: "Vou rolar os dados usando a ferramenta do servidor MCP.",
      tool: { name: mcpTool("dados_rolar")!, input: { notacao: dice } },
    });
  }
  const noteMatch = input.match(/nota[:\s]+["“]?([^"”]+)["”]?/i);
  if (noteMatch && mcpTool("notas_adicionar")) {
    steps.push({
      thinking: "Querem registrar uma nota. O servidor MCP 'laboratorio' tem um bloco de notas — vou usá-lo.",
      say: "Salvando a nota no servidor MCP.",
      tool: { name: mcpTool("notas_adicionar")!, input: { texto: noteMatch[1].trim() } },
    });
  }
  if (/(lembr|memoriz|salv|guard|prefir|gosto)/.test(lower) && has("memory_save")) {
    steps.push({
      thinking: "O usuário pediu (ou revelou) algo que vale lembrar no futuro. Vou salvar na memória de longo prazo.",
      say: "Vou guardar isso na memória de longo prazo.",
      tool: { name: "memory_save", input: { content: input.replace(/^(lembre|memorize|salve|guarde)( que| isso:)?/i, "").trim(), kind: /prefir|gosto/.test(lower) ? "preference" : "fact", tags: ["demo"], importance: 4 } },
    });
  }
  return steps;
}

function summarize(results: { name: string; content: string }[]): string {
  const lines: string[] = [];
  for (const r of results) {
    let data: unknown;
    try {
      data = JSON.parse(r.content);
    } catch {
      data = r.content;
    }
    const d = data as Record<string, unknown>;
    if (typeof r.content === "string" && r.content.startsWith("Erro")) lines.push(`- **${r.name}** falhou: ${r.content}`);
    else if (r.name === "calculator") lines.push(`- 🧮 **Cálculo:** \`${d.expression}\` = **${d.result}**`);
    else if (r.name === "current_time") lines.push(`- 🕒 **Agora:** ${d.local}`);
    else if (r.name === "http_fetch") lines.push(`- 🌐 **Página** (${d.status}): ${String(d.content ?? "").slice(0, 280).replace(/\s+/g, " ")}…`);
    else if (r.name === "memory_search") {
      const arr = Array.isArray(data) ? (data as { content: string; score: number }[]) : [];
      lines.push(arr.length ? `- 🧠 **Memórias encontradas:**\n${arr.slice(0, 3).map((m) => `  - ${m.content.length > 110 ? `${m.content.slice(0, 110)}…` : m.content} _(score ${m.score})_`).join("\n")}` : "- 🧠 Nada relevante na memória ainda.");
    } else if (r.name === "memory_save") lines.push("- 💾 **Memória salva** para as próximas conversas.");
    else if (r.name.endsWith("dados_rolar")) lines.push(`- 🎲 **Dados (via MCP):** ${d.notacao} → [${(d.rolagens as number[]).join(", ")}] = **${d.total}**`);
    else if (r.name.endsWith("notas_adicionar")) lines.push(`- 🗒️ **Nota salva no servidor MCP** (total: ${d.total})`);
    else if (r.name === "scratchpad_write") lines.push("- 📝 Plano registrado no scratchpad.");
    else lines.push(`- 🔧 **${r.name}:** ${r.content.slice(0, 200)}`);
  }
  return lines.join("\n");
}

export async function demoTurn(opts: {
  run: RunRecord;
  agent: AgentConfig;
  tools: Anthropic.Tool[];
  signal: AbortSignal;
  emit: (ev: RunEvent) => void;
}): Promise<AssistantTurn> {
  const { run, tools, signal, emit } = opts;
  const messages = run.messages as Anthropic.Beta.BetaMessageParam[];

  // Encontra a última mensagem do usuário que é texto (a tarefa atual).
  let taskIdx = messages.length - 1;
  while (taskIdx >= 0 && typeof messages[taskIdx].content !== "string") taskIdx--;
  const task = String(messages[taskIdx]?.content ?? run.input);
  const sinceTask = messages.slice(taskIdx + 1);
  const stepIndex = sinceTask.filter((m) => m.role === "assistant").length;

  const toolNames = tools.map((t) => t.name);
  const steps = plan(task, toolNames);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];

  await sleep(350, signal); // "latência de rede"

  if (stepIndex < steps.length) {
    const step = steps[stepIndex];
    await streamText(step.thinking, "thinking.delta", emit, signal);
    content.push({ type: "thinking", thinking: step.thinking, signature: "demo" });
    await streamText(step.say, "text.delta", emit, signal);
    content.push({ type: "text", text: step.say });
    content.push({ type: "tool_use", id: `toolu_demo_${Date.now().toString(36)}`, name: step.tool!.name, input: step.tool!.input });
    return {
      content,
      stopReason: "tool_use",
      usage: { input: Math.round(400 + JSON.stringify(messages).length / 4), output: Math.round((step.thinking.length + step.say.length) / 4 + 30) },
      model: "demo-simulado",
    };
  }

  // Sem mais passos: compõe a resposta final a partir dos resultados observados.
  const toolUseNames = new Map<string, string>();
  const results: { name: string; content: string }[] = [];
  for (const m of sinceTask) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as { type: string; id?: string; name?: string; tool_use_id?: string; content?: unknown }[]) {
      if (b.type === "tool_use") toolUseNames.set(b.id!, b.name!);
      if (b.type === "tool_result") results.push({ name: toolUseNames.get(b.tool_use_id!) ?? "ferramenta", content: String(b.content) });
    }
  }
  const thinking = results.length
    ? `Já tenho ${results.length} observações. Vou sintetizar a resposta final a partir delas.`
    : "Nenhuma ferramenta parece necessária para esta tarefa no modo demo. Vou responder diretamente e explicar como o loop funcionaria.";
  const answer = results.length
    ? `Pronto! Aqui está o que descobri em ${stepIndex} iterações com ferramentas:\n\n${summarize(results)}\n\n> _Modo demonstração: o "LLM" é simulado, mas as ferramentas, a memória e a auditoria são reais. Configure uma chave da Anthropic para usar o Claude de verdade._`
    : `Recebi: "${task}".\n\nNo modo demonstração eu reajo a palavras-chave. Experimente pedir:\n- uma conta (ex.: **quanto é (1250 * 1.08) ^ 2**)\n- **que horas são agora?**\n- **lembre que eu prefiro café sem açúcar**\n- ler uma URL (ex.: **resuma https://example.com**)`;
  await streamText(thinking, "thinking.delta", emit, signal);
  content.push({ type: "thinking", thinking, signature: "demo" });
  await streamText(answer, "text.delta", emit, signal);
  content.push({ type: "text", text: answer });
  return {
    content,
    stopReason: "end_turn",
    usage: { input: Math.round(400 + JSON.stringify(messages).length / 4), output: Math.round(answer.length / 4) },
    model: "demo-simulado",
  };
}
