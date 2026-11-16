import { motion } from "motion/react";
import { Copy, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SpotlightCard } from "../components/effects";
import { Badge, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea } from "../components/ui";
import { api, type PromptTemplate } from "../lib/api";
import { useResource } from "../lib/hooks";

export default function Prompts() {
  const prompts = useResource<PromptTemplate[]>("/api/prompts");
  const [editing, setEditing] = useState<Partial<PromptTemplate> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="engenharia de prompt"
        title="Biblioteca de prompts"
        description={
          <>
            Prompts de <b>sistema</b> definem o comportamento do agente (ex.: ReAct, planejador). Prompts de <b>tarefa</b> são modelos com
            variáveis <code className="text-info">{"{{assim}}"}</code>. Insira prompts de sistema direto no editor de agentes.
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setEditing({ category: "system", name: "", description: "", content: "" })}>
            <Plus size={16} /> Novo prompt
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {prompts.data?.map((p, i) => {
          const vars = [...new Set([...p.content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <SpotlightCard className="h-full p-5" color={p.category === "system" ? "139 92 246" : "34 211 238"}>
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${p.category === "system" ? "bg-accent/15 text-accent" : "bg-info/15 text-info"}`}
                  >
                    <FileText size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 font-semibold">
                      {p.name}{" "}
                      <Badge color={p.category === "system" ? "accent" : "info"}>{p.category === "system" ? "sistema" : "tarefa"}</Badge>
                    </div>
                    <div className="text-[12.5px] text-ink-400">{p.description}</div>
                  </div>
                </div>
                <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-900 p-3 font-mono text-[11.5px] leading-relaxed text-ink-300">
                  {p.content.split(/(\{\{\w+\}\})/).map((part, j) =>
                    part.startsWith("{{") ? (
                      <span key={j} className="rounded bg-info/15 text-info">
                        {part}
                      </span>
                    ) : (
                      part
                    ),
                  )}
                </pre>
                {vars.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {vars.map((v) => (
                      <Badge key={v} color="info">
                        {v}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(p.content);
                      setCopied(p.id);
                      setTimeout(() => setCopied(null), 1200);
                    }}
                  >
                    <Copy size={13} /> {copied === p.id ? "Copiado!" : "Copiar"}
                  </Button>
                  <Button size="sm" onClick={() => setEditing(p)}>
                    <Pencil size={13} /> Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="ml-auto hover:text-bad"
                    aria-label="Remover"
                    onClick={async () => {
                      if (!confirm(`Remover "${p.name}"?`)) return;
                      await api.del(`/api/prompts/${p.id}`);
                      void prompts.reload();
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </SpotlightCard>
            </motion.div>
          );
        })}
      </div>
      {editing && (
        <PromptEditor
          prompt={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void prompts.reload();
          }}
        />
      )}
    </div>
  );
}

function PromptEditor({ prompt, onClose, onSaved }: { prompt: Partial<PromptTemplate>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: prompt.name ?? "",
    description: prompt.description ?? "",
    content: prompt.content ?? "",
    category: prompt.category ?? "system",
  });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      if (prompt.id) await api.put(`/api/prompts/${prompt.id}`, form);
      else await api.post("/api/prompts", form);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open onClose={onClose} wide title={prompt.id ? "Editar prompt" : "Novo prompt"}>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <Field label="Nome">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Tipo">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as "system" | "task" })}>
              <option value="system">Sistema</option>
              <option value="task">Tarefa</option>
            </Select>
          </Field>
        </div>
        <Field label="Descrição">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Conteúdo" hint="use {{variavel}} em prompts de tarefa">
          <Textarea
            rows={8}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="font-mono text-[12.5px]"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!form.name || !form.content}>
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
