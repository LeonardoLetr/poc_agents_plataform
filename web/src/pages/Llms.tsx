import { motion } from "motion/react";
import { Cpu, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { SpotlightCard } from "../components/effects";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Toggle } from "../components/ui";
import { api, type Agent, type Effort, type Health, type Llm, type LlmInput, type Provider } from "../lib/api";
import { useResource } from "../lib/hooks";
import { getRememberKeys, setRememberKeys } from "../lib/runtime";

const PROVIDERS: { id: Provider; label: string; color: string; rgb: string; text: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)", color: "accent", rgb: "201 100 66", text: "SDK oficial, pensamento adaptativo, cache de prompt e fallback em recusas." },
  { id: "openai", label: "Compatível com OpenAI", color: "info", rgb: "74 122 150", text: "Qualquer API no formato Chat Completions: OpenAI, OpenRouter, Groq, Ollama…" },
  { id: "demo", label: "Demo (offline)", color: "ok", rgb: "94 140 74", text: "LLM simulado: segue palavras-chave, sem chave e sem custo." },
];

const EFFORT_HINT: Record<Effort, string> = {
  low: "rápido e barato",
  medium: "padrão do Opus 5.5",
  high: "mais raciocínio",
  xhigh: "ótimo para agentes complexos",
  max: "máximo (lento/caro)",
};

export default function Llms({ health, onChange }: { health: Health | null; onChange: () => void }) {
  const llms = useResource<Llm[]>("/api/llms");
  const agents = useResource<Agent[]>("/api/agents");
  const [editing, setEditing] = useState<{ id?: string; data: LlmInput; llm?: Llm } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const browser = health?.runtime === "browser";
  const [remember, setRemember] = useState(getRememberKeys);

  async function remove(l: Llm) {
    if (!confirm(`Remover a LLM "${l.name}"?`)) return;
    try {
      await api.del(`/api/llms/${l.id}`);
      void llms.reload();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="modelos"
        title="LLMs"
        description="Cadastre quantas LLMs quiser (provedor, modelo e chave) e escolha qual cada agente usa. Tudo muda na hora, sem reiniciar nada."
        actions={
          <Button variant="primary" onClick={() => setEditing({ data: { name: "", provider: "anthropic", model: "claude-opus-5-5", effort: "medium", refusalFallback: true } })}>
            <Plus size={16} /> Nova LLM
          </Button>
        }
      />

      {browser && (
        <div className="mb-6 rounded-2xl border border-black/[0.08] bg-white p-4 text-[13px] leading-relaxed text-ink-300">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <b className="font-medium text-ink-100">Onde fica a sua chave.</b> Fica apenas neste navegador: não é enviada ao GitHub nem a servidores intermediários
              e é enviada direto do seu browser para o provedor (HTTPS). Por padrão ela fica só nesta sessão e{" "}
              <b className="font-medium text-ink-200">some quando você fecha o navegador</b>. Use uma chave dedicada, com limite de gastos, e revogue quando
              terminar de testar.
            </div>
          </div>
          <div className="mt-2 border-t border-black/[0.06] pt-2">
            <Toggle
              checked={remember}
              onChange={(v) => {
                setRememberKeys(v);
                setRemember(v);
              }}
              label="Lembrar chaves neste navegador"
              description="Guarda as chaves no localStorage para não precisar colar de novo. Só ligue em um computador pessoal."
            />
          </div>
        </div>
      )}
      <ErrorNote message={error} />

      <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {llms.data?.map((l, i) => {
          const p = PROVIDERS.find((x) => x.id === l.provider)!;
          const users = agents.data?.filter((a) => a.llmId === l.id) ?? [];
          return (
            <motion.div key={l.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <SpotlightCard className="h-full p-5" color={p.rgb}>
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `rgb(${p.rgb} / 0.1)`, color: `rgb(${p.rgb})` }}>
                    <Cpu size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{l.name}</div>
                    <div className="truncate font-mono text-[11px] text-ink-400">{l.model}</div>
                  </div>
                  <Badge color={l.ready ? "ok" : "warn"}>{l.ready ? "pronta" : "sem chave"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Badge color={p.color as "accent"}>{p.label}</Badge>
                  {l.provider === "anthropic" && <Badge>effort {l.effort}</Badge>}
                  {l.provider === "anthropic" && l.refusalFallback && <Badge>fallback</Badge>}
                  {l.apiKeySet && (
                    <Badge>
                      <KeyRound size={10} /> {l.apiKeyHint}
                    </Badge>
                  )}
                  {l.baseUrl && <Badge className="max-w-full truncate">{l.baseUrl.replace(/^https?:\/\//, "")}</Badge>}
                </div>
                <div className="mt-3 text-[12px] text-ink-400">
                  {users.length ? (
                    <>
                      Usada por{" "}
                      {users.map((a) => (
                        <span key={a.id} className="mr-1 text-ink-200">
                          {a.emoji} {a.name}
                        </span>
                      ))}
                    </>
                  ) : (
                    "Nenhum agente usa esta LLM ainda."
                  )}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditing({
                        id: l.id,
                        llm: l,
                        data: { name: l.name, provider: l.provider, model: l.model, baseUrl: l.baseUrl, effort: l.effort, refusalFallback: l.refusalFallback, maxTokens: l.maxTokens },
                      })
                    }
                  >
                    <Pencil size={13} /> Editar
                  </Button>
                  <Button size="sm" variant="subtle" className="ml-auto hover:text-bad" onClick={() => remove(l)} aria-label="Remover">
                    <Trash2 size={13} />
                  </Button>
                </div>
              </SpotlightCard>
            </motion.div>
          );
        })}
      </div>

      {editing && (
        <LlmEditor
          initial={editing.data}
          id={editing.id}
          existing={editing.llm}
          health={health}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void llms.reload();
            onChange();
          }}
        />
      )}
    </div>
  );
}

function LlmEditor({ initial, id, existing, health, onClose, onSaved }: { initial: LlmInput; id?: string; existing?: Llm; health: Health | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<LlmInput>(initial);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LlmInput>(k: K, v: LlmInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  function pickProvider(provider: Provider) {
    if (provider === form.provider) return;
    if (provider === "anthropic") setForm((f) => ({ ...f, provider, model: "claude-opus-5-5", baseUrl: "" }));
    if (provider === "openai") {
      const p = health?.catalog.openai[0];
      setForm((f) => ({ ...f, provider, model: p?.model ?? "", baseUrl: p?.baseUrl ?? "" }));
    }
    if (provider === "demo") setForm((f) => ({ ...f, provider, model: "demo-simulado", baseUrl: "" }));
  }

  async function save() {
    const body: LlmInput = { ...form, name: form.name.trim() || form.model };
    if (key.trim()) body.apiKey = key.trim();
    else if (clearKey) body.apiKey = "";
    else delete body.apiKey; // mantém a chave atual
    try {
      if (id) await api.put(`/api/llms/${id}`, body);
      else await api.post("/api/llms", body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={id ? `Editar ${initial.name}` : "Nova LLM"}>
      <div className="space-y-5">
        <div className="grid gap-2 md:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => pickProvider(p.id)}
              className={`rounded-xl border p-3 text-left transition ${form.provider === p.id ? "border-black/[0.2] bg-black/[0.045]" : "border-black/[0.064] hover:bg-black/[0.022]"}`}
              style={form.provider === p.id ? { boxShadow: `inset 0 0 0 1px rgb(${p.rgb} / 0.5)` } : undefined}
            >
              <div className="text-[13px] font-medium" style={{ color: `rgb(${p.rgb})` }}>{p.label}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-ink-400">{p.text}</div>
            </button>
          ))}
        </div>

        {form.provider === "openai" && (
          <div>
            <div className="mb-1.5 text-[12px] text-ink-400">Atalhos</div>
            <div className="flex flex-wrap gap-1.5">
              {health?.catalog.openai.map((p) => (
                <button key={p.id} onClick={() => setForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model, name: f.name || p.label }))} className="rounded-full border border-black/[0.08] px-2.5 py-1 text-[12px] text-ink-300 hover:border-info/40 hover:text-ink-100">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" hint="como aparece para os agentes">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="ex.: Claude rápido" />
          </Field>
          <Field label="Modelo" hint={form.provider === "demo" ? "fixo" : "escolha ou digite qualquer id"}>
            <Input list="model-options" value={form.model} disabled={form.provider === "demo"} onChange={(e) => set("model", e.target.value)} className="font-mono" />
            <datalist id="model-options">
              {form.provider === "anthropic" && health?.catalog.anthropic.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}
              {form.provider === "openai" && health?.catalog.openai.map((m) => <option key={m.id} value={m.model}>{m.label}</option>)}
            </datalist>
          </Field>
        </div>

        {form.provider !== "demo" && (
          <>
            <Field
              label="Chave da API"
              hint={existing?.apiKeySet ? `atual: ${existing.apiKeyHint} — deixe vazio para manter` : health?.runtime === "server" ? "opcional se definida no .env" : "obrigatória no modo navegador"}
            >
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={form.provider === "anthropic" ? "sk-ant-..." : "sk-..."} />
            </Field>
            {existing?.apiKeySet && (
              <label className="-mt-3 flex items-center gap-2 text-[12px] text-ink-400">
                <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> remover a chave salva
              </label>
            )}
            <Field label="URL base" hint={form.provider === "anthropic" ? "opcional (proxy/gateway)" : "endpoint compatível com /chat/completions"}>
              <Input value={form.baseUrl ?? ""} onChange={(e) => set("baseUrl", e.target.value)} className="font-mono" placeholder={form.provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"} />
            </Field>
          </>
        )}

        {form.provider === "anthropic" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Esforço (effort)" hint={EFFORT_HINT[form.effort]}>
              <Select value={form.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
                {(Object.keys(EFFORT_HINT) as Effort[]).map((k) => <option key={k}>{k}</option>)}
              </Select>
            </Field>
            <div className="pt-5">
              <Toggle checked={form.refusalFallback} onChange={(v) => set("refusalFallback", v)} label="Fallback em recusas" description="Se o modelo recusar, a API tenta outro modelo automaticamente (Opus/Sonnet/Fable)." />
            </div>
          </div>
        )}
        {form.provider !== "demo" && (
          <Field label="Máximo de tokens de saída" hint="por resposta">
            <Input type="number" min={256} max={128000} value={form.maxTokens ?? (form.provider === "openai" ? 4096 : 64000)} onChange={(e) => set("maxTokens", Number(e.target.value))} />
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!form.model.trim()}>
            Salvar LLM
          </Button>
        </div>
      </div>
    </Modal>
  );
}
