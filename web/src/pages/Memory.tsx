import { AnimatePresence, motion } from "motion/react";
import { Brain, Calendar, MessagesSquare, NotebookPen, Pencil, Plus, Search, Trash2, History } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea } from "../components/ui";
import { api, type Agent, type Memory, type MemoryKind } from "../lib/api";
import { kindLabel, timeAgo } from "../lib/format";
import { useResource } from "../lib/hooks";

const KIND_COLOR: Record<MemoryKind, string> = { fact: "#0284c7", preference: "#ea580c", procedure: "#d97706", episode: "#7c3aed" };

interface Scored {
  memory: Memory;
  score: number;
  breakdown: { relevance: number; importance: number; recency: number };
}

export default function MemoryPage() {
  const memories = useResource<Memory[]>("/api/memories");
  const agents = useResource<Agent[]>("/api/agents");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [results, setResults] = useState<Scored[] | null>(null);
  const [editing, setEditing] = useState<Partial<Memory> | null>(null);

  const list = useMemo(
    () => (memories.data ?? []).filter((m) => !agentFilter || m.agentId === agentFilter || m.agentId === null).slice().reverse(),
    [memories.data, agentFilter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { fact: 0, preference: 0, procedure: 0, episode: 0 };
    for (const m of memories.data ?? []) c[m.kind]++;
    return c;
  }, [memories.data]);
  const agentName = (id: string | null) => (id ? agents.data?.find((a) => a.id === id)?.name ?? "agente removido" : "compartilhada");

  async function search() {
    if (!query.trim()) return setResults(null);
    setResults(await api.get<Scored[]>(`/api/memories/search?q=${encodeURIComponent(query)}&agentId=${agentFilter}`));
  }

  const highlighted = new Set(results?.map((r) => r.memory.id));

  return (
    <div>
      <PageHeader
        eyebrow="memória"
        title="Como um agente lembra"
        description="LLMs não têm memória entre chamadas. Tudo que o agente 'sabe' precisa ser colocado no contexto — e a plataforma usa quatro camadas para isso."
        actions={
          <Button variant="primary" onClick={() => setEditing({ kind: "fact", importance: 3, tags: [], agentId: null, content: "" })}>
            <Plus size={16} /> Nova memória
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <LayerCard icon={<MessagesSquare size={16} />} color="#0284c7" title="Curto prazo" value="histórico" text="As mensagens da conversa atual, reenviadas a cada iteração do loop." />
        <LayerCard icon={<NotebookPen size={16} />} color="#16a34a" title="Trabalho" value="scratchpad" text="Anotações temporárias da execução: planos e resultados parciais." />
        <LayerCard icon={<Brain size={16} />} color="#ea580c" title="Longo prazo" value={`${counts.fact + counts.preference + counts.procedure} itens`} text="Fatos, preferências e procedimentos que sobrevivem entre execuções." />
        <LayerCard icon={<History size={16} />} color="#7c3aed" title="Episódica" value={`${counts.episode} episódios`} text="Resumos automáticos do que o agente já fez." />
      </div>

      {/* Barra de abas/filtros, como nos painéis de referência */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] font-semibold text-ink-100">Quadro de memórias</span>
        <span className="text-[12px] text-ink-400">{list.length} itens</span>
        <div className="ml-auto flex gap-2">
          <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="!h-7 !w-52 text-[12px]">
            <option value="">Todos os agentes</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
          </Select>
        </div>
      </div>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(KIND_COLOR) as MemoryKind[]).map((kind) => {
          const items = list.filter((m) => m.kind === kind);
          return (
            <div key={kind} className="flex flex-col rounded-xl bg-ink-900 p-1.5">
              <div className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[kind] }} />
                <span className="text-[12px] font-semibold capitalize text-ink-100">{kindLabel[kind]}</span>
                <span className="rounded-[5px] bg-ink-850 px-1.5 text-[11px] font-medium text-ink-400">{items.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <AnimatePresence initial={false}>
                  {items.map((m) => (
                    <motion.div
                      key={m.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`group rounded-[10px] border bg-surface p-3 ${highlighted.has(m.id) ? "border-accent" : "border-ink-700"}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-400">
                        <Brain size={11} /> <span className="truncate">{agentName(m.agentId)}</span>
                        <span className="ml-auto normal-case tracking-normal">
                          <Badge color={m.importance >= 4 ? "bad" : m.importance === 3 ? "warn" : "ok"}>{m.importance >= 4 ? "Alta" : m.importance === 3 ? "Média" : "Baixa"}</Badge>
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-4 text-[12.5px] leading-snug text-ink-200">{m.content}</p>
                      {m.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{m.tags.slice(0, 3).map((t) => <Badge key={t}>#{t}</Badge>)}</div>}
                      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                        <Calendar size={11} /> {timeAgo(m.createdAt)}
                        <span className="ml-auto">acessada {m.accessCount}×</span>
                        <button onClick={() => setEditing(m)} className="rounded p-0.5 text-ink-400 hover:bg-ink-850 hover:text-ink-100" aria-label="Editar">
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={async () => {
                            await api.del(`/api/memories/${m.id}`);
                            void memories.reload();
                          }}
                          className="rounded p-0.5 text-ink-400 hover:bg-ink-850 hover:text-bad"
                          aria-label="Remover"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <button
                  onClick={() => setEditing({ kind, importance: 3, tags: [], agentId: null, content: "" })}
                  className="flex h-8 items-center justify-center gap-1 rounded-[10px] border border-dashed border-ink-600 text-[12px] text-ink-400 transition-colors hover:border-ink-500 hover:text-ink-200"
                >
                  <Plus size={12} /> Adicionar {kindLabel[kind]}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        <Card className="relative h-[380px] overflow-hidden lg:col-span-3">
          <div className="absolute left-4 top-3 z-10 text-[12px] text-ink-300">Constelação de memórias</div>
          <div className="absolute right-4 top-3 z-10 flex gap-2">
            {(Object.keys(KIND_COLOR) as MemoryKind[]).map((k) => (
              <span key={k} className="flex items-center gap-1 text-[10.5px] text-ink-400">
                <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {kindLabel[k]}
              </span>
            ))}
          </div>
          <Constellation memories={memories.data ?? []} highlighted={results ? highlighted : null} />
        </Card>

        <Card className="flex flex-col p-4 lg:col-span-2">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-medium">
            <Search size={14} className="text-ink-400" /> Laboratório de recuperação
          </div>
          <p className="mb-3 text-[12px] text-ink-400">Simule o que o agente recupera para uma tarefa. Pontuação = 70% relevância (BM25, com variações da mesma palavra) + 20% importância + 10% recência.</p>
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="ex.: preferências do usuário" />
            <Button onClick={search}>
              <Search size={15} />
            </Button>
          </div>
          <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {results?.length === 0 && <p className="text-[12px] text-ink-500">Nenhuma memória relevante — o agente rodaria sem contexto extra.</p>}
            {results?.map((r, i) => (
              <motion.div key={r.memory.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="rounded-xl bg-ink-900 p-2.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="line-clamp-1 text-ink-200">{r.memory.content}</span>
                  <span className="ml-2 font-mono text-info">{r.score.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-ink-850">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${r.breakdown.relevance * 70}%` }} className="bg-info" title="relevância (BM25)" />
                  <motion.div initial={{ width: 0 }} animate={{ width: `${r.breakdown.importance * 20}%` }} className="bg-mcp" title="importância" />
                  <motion.div initial={{ width: 0 }} animate={{ width: `${r.breakdown.recency * 10}%` }} className="bg-ok" title="recência" />
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      {editing && (
        <MemoryEditor
          memory={editing}
          agents={agents.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void memories.reload();
          }}
        />
      )}
    </div>
  );
}

function LayerCard({ icon, color, title, value, text }: { icon: React.ReactNode; color: string; title: string; value: string; text: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}22`, color }}>
          {icon}
        </div>
        <div>
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="text-[12px] text-ink-400">{value}</div>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-ink-400">{text}</p>
    </Card>
  );
}

/** Visualização: cada memória é uma "estrela" (tamanho = importância, brilho = acessos). */
function Constellation({ memories, highlighted }: { memories: Memory[]; highlighted: Set<string> | null }) {
  const [hover, setHover] = useState<Memory | null>(null);
  const points = useMemo(
    () =>
      memories.map((m, i) => {
        // posição determinística a partir do id
        let h = 0;
        for (const c of m.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const ring = { fact: 0.55, preference: 0.3, procedure: 0.75, episode: 0.9 }[m.kind];
        const angle = ((h % 360) * Math.PI) / 180 + i * 0.3;
        return { m, x: 50 + Math.cos(angle) * ring * 44, y: 52 + Math.sin(angle) * ring * 40, r: 6 + m.importance * 3.5, delay: (h % 50) / 10 };
      }),
    [memories],
  );
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {[0.3, 0.55, 0.75, 0.9].map((r) => (
          <ellipse key={r} cx="50%" cy="52%" rx={`${r * 44}%`} ry={`${r * 40}%`} fill="none" stroke="var(--color-ink-700)" strokeDasharray="3 6" />
        ))}
      </svg>
      <div className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 text-[12px] font-medium text-ink-400">agente</div>
      {points.map(({ m, x, y, r, delay }) => {
        const dim = highlighted && !highlighted.has(m.id);
        const lit = highlighted?.has(m.id);
        return (
          <motion.button
            key={m.id}
            onMouseEnter={() => setHover(m)}
            onMouseLeave={() => setHover(null)}
            className="absolute rounded-full"
            style={{ left: `${x}%`, top: `${y}%`, width: r, height: r, marginLeft: -r / 2, marginTop: -r / 2, background: KIND_COLOR[m.kind], boxShadow: lit ? `0 0 0 4px color-mix(in oklab, ${KIND_COLOR[m.kind]} 25%, transparent)` : "none" }}
            initial={{ scale: 0 }}
            animate={{ scale: lit ? 1.6 : 1, opacity: dim ? 0.18 : 1, y: [0, -5, 0] }}
            transition={{ y: { repeat: Infinity, duration: 4 + delay, ease: "easeInOut" }, scale: { type: "spring" } }}
          />
        );
      })}
      <AnimatePresence>
        {hover && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute bottom-3 left-3 right-3 rounded-xl border border-ink-700 bg-surface p-3 text-[12.5px] text-ink-200 backdrop-blur">
            <Badge>{kindLabel[hover.kind]}</Badge> {hover.content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MemoryEditor({ memory, agents, onClose, onSaved }: { memory: Partial<Memory>; agents: Agent[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    content: memory.content ?? "",
    kind: memory.kind ?? ("fact" as MemoryKind),
    tags: (memory.tags ?? []).join(", "),
    importance: memory.importance ?? 3,
    agentId: memory.agentId ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const body = { ...form, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    try {
      if (memory.id) await api.put(`/api/memories/${memory.id}`, body);
      else await api.post("/api/memories", body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open onClose={onClose} title={memory.id ? "Editar memória" : "Nova memória"}>
      <div className="space-y-4">
        <Field label="Conteúdo" hint="escreva de forma autocontida">
          <Textarea rows={3} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MemoryKind })}>
              {Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Importância" hint={`${form.importance}/5`}>
            <input type="range" min={1} max={5} value={form.importance} onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })} className="mt-3 w-full accent-[#2563eb]" />
          </Field>
        </div>
        <Field label="Escopo">
          <Select value={form.agentId ?? ""} onChange={(e) => setForm({ ...form, agentId: e.target.value || null })}>
            <option value="">Compartilhada (todos os agentes)</option>
            {agents.map((a) => <option key={a.id} value={a.id}>Só {a.name}</option>)}
          </Select>
        </Field>
        <Field label="Tags" hint="separadas por vírgula">
          <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!form.content.trim()}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
