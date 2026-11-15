import { AnimatePresence, motion } from "motion/react";
import { Brain, CheckCircle2, Circle, Plug, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoopDiagram } from "../components/LoopDiagram";
import { Badge, Card, PageHeader } from "../components/ui";

const MESSAGES = [
  { role: "user", tag: "texto", color: "#0284c7", body: "Quanto é 1250 × 1,08²?" },
  { role: "assistant", tag: "thinking + tool_use", color: "#2563eb", body: '💭 "preciso calcular com precisão"\n🔧 calculator({ expression: "1250*1.08^2" })' },
  { role: "user", tag: "tool_result", color: "#d97706", body: '{ "result": 1458 }' },
  { role: "assistant", tag: "texto · end_turn", color: "#16a34a", body: "O resultado é 1.458." },
];

function MessageStack() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x >= MESSAGES.length + 1 ? 1 : x + 1)), 1800);
    return () => clearInterval(id);
  }, []);
  const shown = MESSAGES.slice(0, Math.min(n, MESSAGES.length));
  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-ink-500">messages = [</div>
      <AnimatePresence initial={false}>
        {shown.map((m, i) => (
          <motion.div
            key={i}
            layout
            initial={{ opacity: 0, x: -20, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="ml-4 rounded-xl border p-3"
            style={{ borderColor: `${m.color}44`, background: `${m.color}0d` }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[11px]" style={{ color: m.color }}>role: "{m.role}"</span>
              <Badge>{m.tag}</Badge>
              <span className="ml-auto font-mono text-[10px] text-ink-500">#{i}</span>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[12px] text-ink-200">{m.body}</pre>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className="font-mono text-[11px] text-ink-500">]</div>
      <p className="text-[12px] text-ink-400">
        A cada volta do loop, a lista <b>inteira</b> é reenviada. O modelo não "lembra": ele relê. Por isso o cache de prompt importa — e por isso a janela de
        contexto é um recurso finito.
      </p>
    </div>
  );
}

const GLOSSARY = [
  ["stop_reason", "Por que o modelo parou: tool_use (quer usar ferramenta), end_turn (terminou), max_tokens (cortado), refusal (recusou), pause_turn (pausa de ferramenta do servidor)."],
  ["tool_use / tool_result", "O par do protocolo de ferramentas: o assistente pede (tool_use com id), você executa e devolve tool_result com o mesmo id."],
  ["Pensamento adaptativo", "O modelo decide quanto raciocinar antes de responder. Aqui pedimos o resumo do raciocínio para exibir na timeline."],
  ["effort", "Quanto esforço o modelo investe (low → max). Mais esforço = mais tokens e mais qualidade em tarefas difíceis."],
  ["Prompt caching", "O prefixo repetido (sistema + ferramentas + histórico) é cacheado; as próximas iterações leem do cache, mais rápido e barato."],
  ["Fallback em recusas", "Se um classificador de segurança recusar, a API pode reexecutar o pedido em outro modelo automaticamente."],
  ["MCP", "Model Context Protocol: padrão aberto para servidores exporem ferramentas, recursos e prompts a qualquer cliente compatível."],
  ["Human-in-the-loop", "Uma pessoa aprova ações antes de executarem. Essencial para ferramentas com efeitos colaterais."],
];

const EXERCISES = [
  "Rode o Agente Demo com “Quanto é (1250 * 1.08) ^ 2 e que horas são?” e conte as iterações no grafo.",
  "Abra “Mensagens (janela de contexto)” de uma execução e encontre o par tool_use / tool_result.",
  "Ative “Aprovação humana” em um agente e negue uma ferramenta. Veja como ele reage.",
  "Salve uma preferência (“lembre que prefiro respostas curtas”) e, em outra execução, veja o recall automático.",
  "Teste uma ferramenta direto na página MCP e depois peça ao Explorador MCP para usá-la.",
  "Cadastre duas LLMs (ex.: Opus e Haiku), troque a LLM de um agente e compare tokens e qualidade na auditoria.",
  "Crie um prompt de sistema na biblioteca (ex.: Crítico interno) e aplique a um agente.",
  "Estude o servidor MCP em core/mcp/lab-server.ts e adicione uma ferramenta nova.",
];

export default function Learn() {
  const [done, setDone] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("agentlab.exercises") ?? "[]") as number[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDone(next);
    try {
      localStorage.setItem("agentlab.exercises", JSON.stringify([...next]));
    } catch {
      /* armazenamento indisponível */
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="aprender" title="Como um agente autônomo funciona" description="Os conceitos por trás de tudo que você vê na plataforma — cada um ligado à tela onde você pode experimentá-lo." />

      <section className="grid items-center gap-8 lg:grid-cols-2">
        <LoopDiagram size={360} />
        <div className="space-y-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink-100">1. O loop é o agente</h2>
          <p className="text-[15px] leading-relaxed text-ink-300">
            Um LLM sozinho só transforma texto em texto. Ele vira um <b className="text-ink-100">agente</b> quando colocamos ele num loop com ferramentas: o
            modelo lê o contexto, decide o próximo passo, nós executamos a ação e devolvemos o resultado. Isso se repete até ele responder sem pedir
            ferramentas (<code className="text-ok">stop_reason: end_turn</code>) ou até atingir o limite de iterações.
          </p>
          <p className="text-[15px] leading-relaxed text-ink-300">
            O código desse loop está em <code className="text-info">core/agent/runner.ts</code> — leia junto com o <Link to="/playground" className="text-info underline">playground</Link>.
          </p>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink-100">2. Anatomia da conversa</h2>
          <p className="text-[15px] leading-relaxed text-ink-300">
            Ferramentas funcionam por um protocolo simples: o assistente responde com um bloco <code className="text-accent">tool_use</code> (nome +
            argumentos em JSON). A plataforma executa e responde com <code className="text-warn">tool_result</code> como se fosse o usuário. Ao lado,
            uma conversa real se montando.
          </p>
        </div>
        <Card className="p-5">
          <MessageStack />
        </Card>
      </section>

      <section>
        <h2 className="mb-4 text-[16px] font-semibold tracking-[-0.01em] text-ink-100">3. As peças</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: <Wrench />, color: "#d97706", title: "Ferramentas", to: "/agents", text: "Funções com nome, descrição e schema JSON. A descrição é o que o modelo lê para decidir quando usar — escreva bem!" },
            { icon: <Plug />, color: "#ea580c", title: "MCP", to: "/mcp", text: "Em vez de programar cada ferramenta, conecte servidores que já as oferecem. O cliente descobre tudo via tools/list." },
            { icon: <Brain />, color: "#7c3aed", title: "Memória", to: "/memory", text: "Curto prazo (histórico), trabalho (scratchpad), longo prazo (fatos) e episódica (o que já fez). Tudo vira texto no contexto." },
            { icon: <ShieldCheck />, color: "#16a34a", title: "Auditoria e limites", to: "/audit", text: "Limite de iterações, aprovação humana, bloqueio de IPs privados e registro de cada ação: autonomia com controle." },
          ].map((c, i) => (
            <motion.div key={c.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
              <Link to={c.to}>
                <Card className="h-full p-5 transition hover:border-black/[0.16]">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${c.color}1f`, color: c.color }}>
                    {c.icon}
                  </div>
                  <div className="font-semibold">{c.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-400">{c.text}</p>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-[16px] font-semibold tracking-[-0.01em] text-ink-100">4. Glossário</h2>
          <div className="space-y-2">
            {GLOSSARY.map(([term, def]) => (
              <Card key={term} className="p-3.5">
                <div className="font-mono text-[12.5px] text-info">{term}</div>
                <div className="mt-0.5 text-[13px] text-ink-300">{def}</div>
              </Card>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-4 text-[16px] font-semibold tracking-[-0.01em] text-ink-100">
            5. Experimentos <span className="text-[14px] font-normal text-ink-400">({done.size}/{EXERCISES.length})</span>
          </h2>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black/[0.038]">
            <motion.div className="h-full bg-accent/70" animate={{ width: `${(done.size / EXERCISES.length) * 100}%` }} />
          </div>
          <div className="space-y-2">
            {EXERCISES.map((ex, i) => (
              <button key={i} onClick={() => toggle(i)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-[13.5px] transition ${done.has(i) ? "border-ok/25 bg-ok/5 text-ink-400 line-through" : "border-black/[0.064] bg-black/[0.015] text-ink-200 hover:bg-black/[0.03]"}`}>
                {done.has(i) ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={17} className="mt-0.5 shrink-0 text-ink-500" />}
                {ex}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
