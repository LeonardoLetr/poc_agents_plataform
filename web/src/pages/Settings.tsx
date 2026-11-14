import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input, PageHeader } from "../components/ui";
import { api, type Health } from "../lib/api";

export default function Settings({ health, onSaved }: { health: Health | null; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save(value: string) {
    try {
      await api.put("/api/settings", { anthropicApiKey: value });
      setKey("");
      setOk(true);
      setTimeout(() => setOk(false), 2000);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="configurações" title="Conexão com o Claude" description="Os agentes com provedor “Anthropic” usam a API do Claude. Sem chave, use os agentes de demonstração." />
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${health?.anthropicConfigured ? "bg-mint/15 text-mint" : "bg-amber/15 text-amber"}`}>
            <KeyRound size={18} />
          </div>
          <div>
            <div className="font-medium">{health?.anthropicConfigured ? "Credenciais configuradas" : "Nenhuma credencial"}</div>
            <div className="text-[12.5px] text-ink-400">
              {health?.keySource === "env" && "Lidas do ambiente (ANTHROPIC_API_KEY no arquivo .env)."}
              {health?.keySource === "ui" && "Chave salva por esta tela (em server/data/db.json, fora do git)."}
              {!health?.keySource && "Crie uma chave em platform.claude.com e cole abaixo, ou defina ANTHROPIC_API_KEY no .env."}
            </div>
          </div>
        </div>
        <Field label="Chave da API da Anthropic" hint="fica apenas no seu servidor local">
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => save(key)} disabled={!key.trim()}>
            {ok ? <CheckCircle2 size={15} /> : <KeyRound size={15} />} {ok ? "Salvo!" : "Salvar chave"}
          </Button>
          {health?.keySource === "ui" && (
            <Button variant="danger" onClick={() => save("")}>
              <Trash2 size={14} /> Remover chave salva
            </Button>
          )}
        </div>
      </Card>
      <Card className="mt-4 p-6 text-[13.5px] leading-relaxed text-ink-300">
        <div className="mb-2 font-medium text-ink-100">Modelos disponíveis</div>
        <ul className="space-y-1.5">
          {health?.models.map((m) => (
            <li key={m.id}>
              <code className="text-cyan">{m.id}</code> — {m.note}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
