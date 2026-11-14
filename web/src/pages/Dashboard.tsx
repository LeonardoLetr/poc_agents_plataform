import { motion } from "motion/react";
import { ArrowRight, Bot, Brain, Coins, Plug, Repeat, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BlurText, LiveDot, NumberTicker, SpotlightCard } from "../components/effects";
import { LoopDiagram } from "../components/LoopDiagram";
import { Button, Card } from "../components/ui";
import type { Agent, AuditEntry, Health, Llm, Stats } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useEventStream, useInterval, useResource } from "../lib/hooks";

export default function Dashboard({ health }: { health: Health | null }) {
  const stats = useResource<Stats>("/api/stats");
  const agents = useResource<Agent[]>("/api/agents");
  const llms = useResource<Llm[]>("/api/llms");
  const recent = useResource<{ entries: AuditEntry[] }>("/api/audit?limit=12");
  const [feed, setFeed] = useState<AuditEntry[]>([]);
  useInterval(stats.reload, 8000);
  useEventStream<AuditEntry>("/api/audit/stream", (e) => setFeed((f) => [e, ...f].slice(0, 12)));
  const activity = [...feed, ...(recent.data?.entries ?? [])].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i).slice(0, 12);
  const s = stats.data;
  const toolUsage = Object.entries(s?.toolUsage ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxUse = Math.max(1, ...toolUsage.map((t) => t[1]));

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] text-ink-300">
            <LiveDot color={health?.llmsReady && health.llmsReady > 1 ? "bg-mint" : "bg-amber"} />
            {health?.llmsReady && health.llmsReady > 1 ? `${health.llmsReady} LLMs prontas — agentes reais` : "Sem chave ainda: experimente o Agente Demo ou configure uma LLM"}
            {health?.runtime === "browser" && <span className="text-ink-500">· rodando no navegador</span>}
          </motion.div>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-[3.5rem]">
            <BlurText text="Um laboratório para ver" />{" "}
            <BlurText text="agentes autônomos" delay={0.25} className="font-serif text-[1.12em] font-normal italic" wordClassName="text-gradient pr-[0.06em]" />{" "}
            <BlurText text="por dentro." delay={0.45} />
          </h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink-300">
            Crie agentes, conecte ferramentas via MCP, gerencie memória e acompanhe cada decisão em tempo real — o raciocínio, as chamadas de ferramenta, os
            tokens e a trilha de auditoria completa.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} className="mt-7 flex flex-wrap gap-3">
            <Link to="/playground">
              <Button variant="primary" className="h-11 px-5">
                Abrir o playground <ArrowRight size={16} />
              </Button>
            </Link>
            <Link to="/learn">
              <Button className="h-11 px-5">Como funciona?</Button>
            </Link>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.8 }}>
          <LoopDiagram />
        </motion.div>
      </section>

      {/* Números */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={<Bot size={15} />} label="Agentes" value={s?.agents ?? 0} color="#8b5cf6" />
        <StatCard icon={<Repeat size={15} />} label="Execuções" value={s?.runs ?? 0} color="#22d3ee" />
        <StatCard icon={<Wrench size={15} />} label="Chamadas de ferramenta" value={s?.toolCalls ?? 0} color="#f59e0b" />
        <StatCard icon={<Brain size={15} />} label="Memórias" value={s?.memories ?? 0} color="#a78bfa" />
        <StatCard icon={<Plug size={15} />} label="MCP conectados" value={s?.mcpConnected ?? 0} suffix={` / ${s?.mcpServers ?? 0}`} color="#f472b6" />
        <StatCard icon={<Coins size={15} />} label="Custo estimado (US$)" value={s?.estimatedCostUsd ?? 0} decimals={4} color="#34d399" />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        {/* Atividade ao vivo */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <LiveDot /> Atividade ao vivo
            </div>
            <Link to="/audit" className="flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-200">
              <ShieldCheck size={13} /> auditoria completa
            </Link>
          </div>
          <div className="space-y-1">
            {activity.length === 0 && <p className="py-8 text-center text-sm text-ink-500">Nada por aqui ainda. Rode um agente no playground!</p>}
            {activity.map((e, i) => (
              <motion.div key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.02]">
                <span className="font-mono text-[10.5px] text-ink-500">{fmtTime(e.ts)}</span>
                <span className="w-28 shrink-0 truncate font-mono text-[10.5px] text-cyan/80">{e.type}</span>
                <span className="truncate text-[13px] text-ink-300">{e.summary}</span>
              </motion.div>
            ))}
          </div>
        </Card>

        {/* Ferramentas mais usadas */}
        <Card className="p-5">
          <div className="mb-4 text-[14px] font-medium">Ferramentas mais usadas</div>
          {toolUsage.length === 0 && <p className="text-sm text-ink-500">Nenhuma ferramenta chamada ainda.</p>}
          <div className="space-y-3">
            {toolUsage.map(([name, n]) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-[12px]">
                  <span className="truncate font-mono text-ink-200">{name}</span>
                  <span className="text-ink-400">{n}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-violet to-cyan" initial={{ width: 0 }} animate={{ width: `${(n / maxUse) * 100}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Agentes */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Seus agentes</h2>
          <Link to="/agents" className="text-[12.5px] text-ink-400 hover:text-ink-200">gerenciar →</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {agents.data?.map((a) => (
            <Link key={a.id} to="/playground">
              <SpotlightCard className="h-full p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-xl" style={{ background: `${a.color}22` }}>{a.emoji}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{a.name}</div>
                    <div className="font-mono text-[10.5px] text-ink-400">{a.tools.length} ferramentas · {llms.data?.find((l) => l.id === a.llmId)?.name ?? "sem LLM"}</div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-400">{a.description}</p>
              </SpotlightCard>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, color, suffix = "", decimals = 0 }: { icon: React.ReactNode; label: string; value: number; color: string; suffix?: string; decimals?: number }) {
  return (
    <SpotlightCard className="p-4" color={hexRgb(color)}>
      <div className="flex items-center gap-2 text-[11.5px] text-ink-400">
        <span style={{ color }}>{icon}</span> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">
        <NumberTicker value={value} decimals={decimals} suffix={suffix} />
      </div>
    </SpotlightCard>
  );
}

function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
