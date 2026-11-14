import { motion } from "motion/react";
import { Bot, Copy, FileText, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SpotlightCard } from "../components/effects";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea, Toggle } from "../components/ui";
import { api, type Agent, type AgentInput, type Health, type PromptTemplate, type ToolInfo } from "../lib/api";
import { toolLabel } from "../lib/format";
import { useResource } from "../lib/hooks";

const EMOJIS = ["🤖", "🔎", "📊", "🧠", "🎬", "🔌", "🛠️", "📚", "🧑‍💻", "🦉", "🚀", "🧪"];
const COLORS = ["#8b5cf6", "#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#fb7185", "#a78bfa", "#60a5fa"];
const EFFORT_HINT: Record<string, string> = {
  low: "rápido e barato",
  medium: "padrão do Opus 5.5",
  high: "mais raciocínio",
  xhigh: "ótimo para agentes complexos",
  max: "máximo (lento/caro)",
};

const blank: AgentInput = {
  name: "",
  emoji: "🤖",
  color: "#8b5cf6",
  description: "",
  provider: "anthropic",
  model: "claude-opus-5-5",
  effort: "medium",
  systemPrompt: "Você é um agente prestativo. Planeje antes de agir e explique o que está fazendo. Responda em português.",
  tools: ["calculator", "current_time"],
  maxIterations: 10,
  requireApproval: false,
  memory: { autoRecall: true, autoEpisode: true, recallLimit: 5 },
  refusalFallback: true,
};

export default function Agents() {
  const agents = useResource<Agent[]>("/api/agents");
  const [editing, setEditing] = useState<{ id?: string; data: AgentInput } | null>(null);
  const navigate = useNavigate();

  async function remove(a: Agent) {
    if (!confirm(`Remover o agente "${a.name}"?`)) return;
    await api.del(`/api/agents/${a.id}`);
    void agents.reload();
  }

  return (
    <div>
      <PageHeader
        eyebrow="configuração"
        title="Agentes"
        description="Um agente = modelo + prompt de sistema + ferramentas + política de memória + limites. Mude uma peça e veja como o comportamento muda."
        actions={
          <Button variant="primary" onClick={() => setEditing({ data: structuredClone(blank) })}>
            <Plus size={16} /> Novo agente
          </Button>
        }
      />
      {agents.data?.length === 0 && <EmptyState icon={<Bot />} title="Nenhum agente" description="Crie o primeiro para começar." />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.data?.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <SpotlightCard className="h-full p-5" color={hexToRgb(a.color)}>
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl" style={{ background: `${a.color}22`, boxShadow: `0 0 30px -8px ${a.color}` }}>
                  {a.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{a.name}</div>
                  <div className="font-mono text-[11px] text-ink-400">{a.provider === "demo" ? "LLM simulado (offline)" : `${a.model} · effort ${a.effort}`}</div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 min-h-[2.5em] text-[13px] text-ink-300">{a.description || a.systemPrompt}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {a.tools.slice(0, 6).map((t) => {
                  const { label, server } = toolLabel(t);
                  return <Badge key={t} color={server ? "pink" : "amber"}>{server ? `${server}:${label}` : label}</Badge>;
                })}
                {a.tools.length > 6 && <Badge>+{a.tools.length - 6}</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {a.memory.autoRecall && <Badge color="violet">recall automático</Badge>}
                {a.memory.autoEpisode && <Badge color="violet">memória episódica</Badge>}
                {a.requireApproval && <Badge color="amber">aprovação humana</Badge>}
                <Badge>máx {a.maxIterations} it.</Badge>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => navigate("/playground")}>
                  <Play size={13} /> Testar
                </Button>
                <Button size="sm" onClick={() => setEditing({ id: a.id, data: strip(a) })}>
                  <Pencil size={13} /> Editar
                </Button>
                <Button size="sm" variant="subtle" onClick={() => setEditing({ data: { ...strip(a), name: `${a.name} (cópia)` } })} aria-label="Duplicar">
                  <Copy size={13} />
                </Button>
                <Button size="sm" variant="subtle" className="ml-auto hover:text-rose" onClick={() => remove(a)} aria-label="Remover">
                  <Trash2 size={13} />
                </Button>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
      {editing && (
        <AgentEditor
          initial={editing.data}
          id={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void agents.reload();
          }}
        />
      )}
    </div>
  );
}

function strip(a: Agent): AgentInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
  return structuredClone(rest);
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function AgentEditor({ initial, id, onClose, onSaved }: { initial: AgentInput; id?: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AgentInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const tools = useResource<ToolInfo[]>("/api/tools");
  const prompts = useResource<PromptTemplate[]>("/api/prompts");
  const health = useResource<Health>("/api/health");
  const set = <K extends keyof AgentInput>(k: K, v: AgentInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleTool = (name: string) => set("tools", form.tools.includes(name) ? form.tools.filter((t) => t !== name) : [...form.tools, name]);

  const builtin = tools.data?.filter((t) => t.source === "builtin") ?? [];
  const mcpServers = [...new Set(tools.data?.filter((t) => t.source === "mcp").map((t) => t.server!) ?? [])];

  async function save() {
    try {
      if (id) await api.put(`/api/agents/${id}`, form);
      else await api.post("/api/agents", form);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={id ? `Editar ${initial.name}` : "Novo agente"}>
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Pesquisador" />
          </Field>
          <Field label="Aparência">
            <div className="flex items-center gap-2">
              <Select value={form.emoji} onChange={(e) => set("emoji", e.target.value)} className="!w-16">
                {EMOJIS.map((e) => <option key={e}>{e}</option>)}
              </Select>
              <div className="flex gap-1">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => set("color", c)} className={`h-6 w-6 rounded-full transition ${form.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-ink-900" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </div>
          </Field>
        </div>
        <Field label="Descrição">
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Para que serve este agente?" />
        </Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Provedor" hint={form.provider === "demo" ? "sem chave de API" : undefined}>
            <Select value={form.provider} onChange={(e) => set("provider", e.target.value as AgentInput["provider"])}>
              <option value="anthropic">Anthropic (Claude real)</option>
              <option value="demo">Demo (LLM simulado)</option>
            </Select>
          </Field>
          <Field label="Modelo">
            <Select value={form.model} disabled={form.provider === "demo"} onChange={(e) => set("model", e.target.value)}>
              {health.data?.models.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}
            </Select>
          </Field>
          <Field label="Esforço (effort)" hint={EFFORT_HINT[form.effort]}>
            <Select value={form.effort} disabled={form.provider === "demo"} onChange={(e) => set("effort", e.target.value as AgentInput["effort"])}>
              {Object.keys(EFFORT_HINT).map((k) => <option key={k}>{k}</option>)}
            </Select>
          </Field>
        </div>

        <Field
          label="Prompt de sistema"
          hint={
            <span className="flex items-center gap-1">
              <FileText size={11} /> inserir da biblioteca:
              <select
                className="ml-1 rounded bg-ink-800 px-1 text-ink-200"
                value=""
                onChange={(e) => {
                  const p = prompts.data?.find((x) => x.id === e.target.value);
                  if (p) set("systemPrompt", `${form.systemPrompt.trim()}\n\n${p.content}`.trim());
                }}
              >
                <option value="">escolher…</option>
                {prompts.data?.filter((p) => p.category === "system").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </span>
          }
        >
          <Textarea rows={6} value={form.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} className="font-mono text-[12.5px]" />
        </Field>

        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-200">Ferramentas</div>
          <div className="grid gap-2 md:grid-cols-2">
            {builtin.map((t) => (
              <label key={t.name} className={`flex cursor-pointer gap-2.5 rounded-xl border p-2.5 transition ${form.tools.includes(t.name) ? "border-amber/40 bg-amber/5" : "border-white/8 hover:bg-white/[0.03]"}`}>
                <input type="checkbox" className="mt-0.5 accent-[#f59e0b]" checked={form.tools.includes(t.name)} onChange={() => toggleTool(t.name)} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink-100">
                    {t.name} <Badge>{t.category}</Badge>
                  </span>
                  <span className="line-clamp-2 text-[11.5px] text-ink-400">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
          {mcpServers.length > 0 && (
            <div className="mt-3 space-y-2">
              {mcpServers.map((server) => {
                const wildcard = `mcp__${server}__*`;
                const serverTools = tools.data!.filter((t) => t.server === server);
                return (
                  <div key={server} className="rounded-xl border border-pink/20 bg-pink/[0.03] p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <input type="checkbox" className="accent-[#f472b6]" checked={form.tools.includes(wildcard)} onChange={() => toggleTool(wildcard)} />
                      <span className="font-medium text-pink">MCP: {server}</span> <span className="text-ink-400">— todas as {serverTools.length} ferramentas</span>
                    </label>
                    {!form.tools.includes(wildcard) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {serverTools.map((t) => (
                          <button key={t.name} onClick={() => toggleTool(t.name)} className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${form.tools.includes(t.name) ? "border-pink/50 bg-pink/15 text-pink" : "border-white/10 text-ink-400"}`}>
                            {toolLabel(t.name).label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {mcpServers.length === 0 && <p className="mt-2 text-[12px] text-ink-500">Conecte um servidor MCP para ver ferramentas externas aqui.</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/8 p-2">
            <div className="px-2 pt-1 text-[12px] font-medium text-ink-400">Memória</div>
            <Toggle checked={form.memory.autoRecall} onChange={(v) => set("memory", { ...form.memory, autoRecall: v })} label="Recall automático" description="Busca memórias relevantes e injeta no prompt de sistema antes de rodar." />
            <Toggle checked={form.memory.autoEpisode} onChange={(v) => set("memory", { ...form.memory, autoEpisode: v })} label="Memória episódica" description="Salva um resumo de cada execução concluída." />
          </div>
          <div className="rounded-xl border border-white/8 p-2">
            <div className="px-2 pt-1 text-[12px] font-medium text-ink-400">Controle e segurança</div>
            <Toggle checked={form.requireApproval} onChange={(v) => set("requireApproval", v)} label="Aprovação humana" description="Pausa antes de cada ferramenta e pede sua autorização." />
            <Toggle checked={form.refusalFallback} onChange={(v) => set("refusalFallback", v)} label="Fallback em recusas" description="Se o modelo recusar, a API tenta outro modelo automaticamente." />
            <div className="px-2 pt-1">
              <Field label="Máximo de iterações" hint="evita loops infinitos">
                <Input type="number" min={1} max={50} value={form.maxIterations} onChange={(e) => set("maxIterations", Number(e.target.value))} />
              </Field>
            </div>
          </div>
        </div>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!form.name.trim()}>
            Salvar agente
          </Button>
        </div>
      </div>
    </Modal>
  );
}
