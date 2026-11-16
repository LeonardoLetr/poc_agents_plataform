import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, ChevronDown, Loader2, Pencil, Plug, PlugZap, Plus, Power, Terminal, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { LiveDot } from "../components/effects";
import { JsonView } from "../components/JsonView";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea } from "../components/ui";
import { api, type Health, type McpServer } from "../lib/api";
import { fmtMs } from "../lib/format";
import { useEventStream, useResource } from "../lib/hooks";

const PRESETS = [
  { name: "everything", label: "Everything (referência oficial)", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-everything", note: "Servidor de testes com ferramentas, prompts e recursos de exemplo." },
  { name: "filesystem", label: "Filesystem", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-filesystem /tmp", note: "Lê e escreve arquivos dentro da pasta permitida (último argumento)." },
  { name: "memory_graph", label: "Memory (grafo de conhecimento)", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-memory", note: "Memória persistente em forma de grafo de entidades e relações." },
  { name: "fetch", label: "Fetch (Python/uvx)", transport: "stdio", command: "uvx", args: "mcp-server-fetch", note: "Busca páginas e converte para markdown. Requer uv instalado." },
  { name: "git", label: "Git (Python/uvx)", transport: "stdio", command: "uvx", args: "mcp-server-git --repository .", note: "Ferramentas para ler histórico e diffs de um repositório git." },
  { name: "resend", label: "Resend (e-mail)", transport: "http", url: "https://mcp.resend.com/mcp", headers: "Authorization: Bearer re_sua_chave", via: "anthropic", note: "Servidor oficial do Resend para enviar e-mails, conectado pela API da Anthropic. Chave em resend.com/api-keys." },
  { name: "remoto", label: "Servidor remoto (HTTP)", transport: "http", url: "https://exemplo.com/mcp", note: "Qualquer servidor MCP via Streamable HTTP (com fallback para SSE)." },
] as const;

const statusMeta = {
  connected: { color: "bg-ok", text: "conectado", badge: "ok" as const },
  connecting: { color: "bg-warn", text: "conectando…", badge: "warn" as const },
  error: { color: "bg-bad", text: "erro", badge: "bad" as const },
  disconnected: { color: "bg-ink-500", text: "desconectado", badge: "ink" as const },
};

export default function Mcp() {
  const servers = useResource<McpServer[]>("/api/mcp");
  const health = useResource<Health>("/api/health");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);

  useEventStream<{ id: string } & McpServer["state"]>("/api/mcp/events", (e) => {
    servers.setData((list) => list?.map((s) => (s.id === e.id ? { ...s, state: { ...e } } : s)) ?? list);
  });

  return (
    <div>
      <PageHeader
        eyebrow="model context protocol"
        title="Servidores MCP"
        description={
          <>
            MCP é um protocolo aberto: o servidor anuncia suas ferramentas (<code className="text-info">tools/list</code>) e o cliente as executa (
            <code className="text-info">tools/call</code>). Conecte um servidor e as ferramentas dele ficam disponíveis para seus agentes como{" "}
            <code className="text-mcp">mcp__servidor__ferramenta</code>.
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Adicionar servidor
          </Button>
        }
      />

      <ProtocolExplainer />

      {servers.data?.length === 0 && <EmptyState icon={<Plug />} title="Nenhum servidor MCP" description="Adicione um para expandir as capacidades dos seus agentes." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {servers.data?.map((s) => <ServerCard key={s.id} server={s} onChange={servers.reload} onEdit={() => setEditing(s)} />)}
      </div>
      {(adding || editing) && (
        <ServerForm
          health={health.data}
          initial={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            void servers.reload();
          }}
        />
      )}
    </div>
  );
}

const PROTOCOL_STEPS = [
  {
    title: "Conectar",
    method: "initialize",
    direction: "cliente → servidor",
    text: "O Agent Lab abre a conexão e os dois lados combinam a versão do protocolo e o que cada um suporta.",
    example: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "agent-lab" } } },
  },
  {
    title: "Descobrir ferramentas",
    method: "tools/list",
    direction: "cliente → servidor",
    text: "O servidor responde com a lista de ferramentas: nome, descrição e o esquema dos argumentos. Elas aparecem para os agentes como mcp__servidor__ferramenta.",
    example: { tools: [{ name: "send_email", description: "Envia um e-mail", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" } } } }] },
  },
  {
    title: "Chamar",
    method: "tools/call",
    direction: "cliente → servidor",
    text: "Quando o modelo decide usar a ferramenta, o loop do agente envia a chamada com os argumentos que o modelo gerou.",
    example: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "send_email", arguments: { to: "ana@exemplo.com", subject: "Relatório" } } },
  },
  {
    title: "Resultado",
    method: "result",
    direction: "servidor → cliente",
    text: "O servidor executa e devolve o conteúdo. O loop entrega esse resultado ao modelo como tool_result, e o modelo decide o próximo passo.",
    example: { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "E-mail enviado (id 4f2a)" }], isError: false } },
  },
];

/** Explicação do protocolo em etapas, no ritmo de quem lê (sem animação automática). */
function ProtocolExplainer() {
  const [step, setStep] = useState(0);
  const current = PROTOCOL_STEPS[step];
  return (
    <Card className="mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink-100">Como o MCP funciona</span>
        <span className="text-[12px] text-ink-400">quatro mensagens entre o Agent Lab (cliente) e o servidor</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ol className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
          {PROTOCOL_STEPS.map((s, i) => (
            <li key={s.method} className="shrink-0">
              <button
                onClick={() => setStep(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${i === step ? "bg-ink-850" : "hover:bg-ink-850/60"}`}
                aria-current={i === step ? "step" : undefined}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i === step ? "bg-mcp text-white" : i < step ? "bg-mcp/15 text-mcp" : "bg-ink-850 text-ink-400"}`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className={`block text-[12.5px] ${i === step ? "font-medium text-ink-100" : "text-ink-300"}`}>{s.title}</span>
                  <span className="block font-mono text-[10.5px] text-ink-500">{s.method}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-md border border-ink-700 px-2 py-0.5 text-ink-300">Agent Lab</span>
            <span className="font-mono text-[11px] text-ink-400">{current.direction.startsWith("cliente") ? "———→" : "←———"}</span>
            <span className="rounded-md border border-mcp/30 bg-mcp/[0.06] px-2 py-0.5 text-mcp">Servidor MCP</span>
            <code className="ml-auto rounded bg-ink-850 px-1.5 py-0.5 font-mono text-[11px] text-info">{current.method}</code>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-300">{current.text}</p>
          <div className="mt-2.5">
            <JsonView value={current.example} maxHeight={170} />
          </div>
          <div className="mt-3 flex justify-between">
            <Button size="sm" onClick={() => setStep(step - 1)} disabled={step === 0}>
              <ArrowLeft size={13} /> Anterior
            </Button>
            <Button size="sm" onClick={() => setStep(step + 1)} disabled={step === PROTOCOL_STEPS.length - 1}>
              Próximo <ArrowRight size={13} />
            </Button>
          </div>
        </motion.div>
      </div>
    </Card>
  );
}

function ServerCard({ server, onChange, onEdit }: { server: McpServer; onChange: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [testing, setTesting] = useState<McpServer["state"]["tools"][number] | null>(null);
  const meta = statusMeta[server.state.status];

  async function act(path: string) {
    setBusy(true);
    try {
      await api.post(`/api/mcp/${server.id}/${path}`);
    } finally {
      setBusy(false);
      onChange();
    }
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={`p-5 ${server.state.status === "connecting" ? "beam [--beam-color:var(--color-warn)]" : ""}`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${server.state.status === "connected" ? "bg-mcp/15 text-mcp" : "bg-ink-850 text-ink-400"}`}>
            {server.state.status === "connected" ? <PlugZap size={20} /> : <Plug size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{server.name}</span>
              <Badge color={meta.badge}>
                <LiveDot color={meta.color} active={server.state.status === "connected" || server.state.status === "connecting"} />{" "}
                {server.via === "anthropic" && server.state.status === "connected" ? "pronto" : meta.text}
              </Badge>
              {server.state.serverInfo && <span className="font-mono text-[10.5px] text-ink-500">v{server.state.serverInfo.version}</span>}
              {server.via === "anthropic" && <Badge color="info">via Anthropic</Badge>}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-ink-400">
              {server.transport === "stdio" ? `$ ${server.command} ${(server.args ?? []).join(" ")}` : server.transport === "builtin" ? `embutido: ${server.command} (transporte em memória)` : server.url}
            </div>
          </div>
          <div className="flex gap-1">
            {server.state.status === "connected" ? (
              <Button size="sm" onClick={() => act("disconnect")} disabled={busy}>
                <Power size={13} /> Desligar
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => act("connect")} disabled={busy || server.state.status === "connecting"}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Conectar
              </Button>
            )}
            <Button size="sm" variant="subtle" aria-label="Editar" title="Editar" onClick={onEdit}>
              <Pencil size={13} />
            </Button>
            <Button
              size="sm"
              variant="subtle"
              className="hover:text-bad"
              aria-label="Remover"
              onClick={async () => {
                if (!confirm(`Remover o servidor "${server.name}"?`)) return;
                await api.del(`/api/mcp/${server.id}`);
                onChange();
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>

        {server.state.error && <div className="mt-3 whitespace-pre-line rounded-lg bg-bad/10 px-3 py-2 text-[12px] leading-relaxed text-bad">{server.state.error}</div>}
        {server.via === "anthropic" && server.state.status === "connected" && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-300">
            A API da Anthropic conecta a este servidor durante as execuções de agentes com LLM Anthropic. As ferramentas aparecem na linha do tempo quando o
            agente as usa; habilite <code className="text-mcp">mcp__{server.name}__*</code> no editor do agente.
          </p>
        )}
        {server.state.instructions && <p className="mt-3 text-[12.5px] text-ink-300">📋 {server.state.instructions}</p>}

        {server.state.tools.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-500">{server.state.tools.length} ferramentas descobertas</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {server.state.tools.map((t, i) => (
                <motion.button
                  key={t.name}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setTesting(t)}
                  className="group rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-left transition hover:border-mcp/40 hover:bg-mcp/5"
                >
                  <div className="flex items-center justify-between font-mono text-[12px] text-ink-100">
                    {t.name}
                    <span className="text-[10px] text-mcp opacity-0 transition group-hover:opacity-100">testar →</span>
                  </div>
                  <div className="line-clamp-1 text-[11px] text-ink-400">{t.description}</div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => setShowLogs(!showLogs)} className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-400 hover:text-ink-200">
          <Terminal size={12} /> logs da conexão <ChevronDown size={12} className={`transition ${showLogs ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {showLogs && (
            <motion.pre initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="mt-2 max-h-56 overflow-auto rounded-xl bg-ink-900 p-3 font-mono text-[11px] leading-relaxed text-ok/80">
              {server.state.logs.join("\n") || "(sem logs)"}
            </motion.pre>
          )}
        </AnimatePresence>
      </Card>
      {testing && <ToolTester server={server} tool={testing} onClose={() => setTesting(null)} />}
    </motion.div>
  );
}

function ToolTester({ server, tool, onClose }: { server: McpServer; tool: McpServer["state"]["tools"][number]; onClose: () => void }) {
  const props = tool.inputSchema.properties ?? {};
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ text: string; isError: boolean; durationMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const parsed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (v === "") continue;
        const type = props[k]?.type;
        parsed[k] = type === "number" || type === "integer" ? Number(v) : type === "boolean" ? v === "true" : type === "object" || type === "array" ? JSON.parse(v) : v;
      }
      setResult(await api.post(`/api/mcp/${server.id}/tools/${tool.name}/call`, { arguments: parsed }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={<span className="font-mono">{server.name} · {tool.name}</span>}>
      <p className="mb-4 text-sm text-ink-300">{tool.description}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {Object.entries(props).map(([k, p]) => (
            <Field key={k} label={`${k}${tool.inputSchema.required?.includes(k) ? " *" : ""}`} hint={p.type}>
              {p.enum ? (
                <Select value={args[k] ?? ""} onChange={(e) => setArgs({ ...args, [k]: e.target.value })}>
                  <option value="">—</option>
                  {p.enum.map((o) => <option key={o}>{o}</option>)}
                </Select>
              ) : (
                <Input value={args[k] ?? ""} placeholder={p.description} onChange={(e) => setArgs({ ...args, [k]: e.target.value })} />
              )}
            </Field>
          ))}
          {Object.keys(props).length === 0 && <p className="text-sm text-ink-400">Esta ferramenta não recebe argumentos.</p>}
          <Button variant="primary" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Executar tools/call
          </Button>
          <ErrorNote message={error} />
        </div>
        <div className="space-y-2">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">schema de entrada</div>
          <JsonView value={tool.inputSchema} maxHeight={180} />
          {result && (
            <>
              <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
                resultado <Badge color={result.isError ? "bad" : "ok"}>{result.isError ? "isError" : "ok"} · {fmtMs(result.durationMs)}</Badge>
              </div>
              <JsonView value={result.text} maxHeight={220} />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Cadastro e edição. Na edição, valores ocultos (••••) mantêm o que já está salvo no servidor. */
function ServerForm({ health, initial, onClose, onSaved }: { health: Health | null; initial: McpServer | null; onClose: () => void; onSaved: () => void }) {
  const stdio = health?.capabilities.stdio ?? true;
  type T = "stdio" | "http" | "builtin";
  const lines = (o?: Record<string, string>, sep = ": ") => Object.entries(o ?? {}).map(([k, v]) => `${k}${sep}${v}`).join("\n");
  const [form, setForm] = useState(
    initial
      ? { name: initial.name, transport: initial.transport as T, command: initial.command ?? "", args: (initial.args ?? []).join(" "), env: lines(initial.env, "="), url: initial.url ?? "", headers: lines(initial.headers), via: initial.via ?? "client" }
      : { name: "", transport: (stdio ? "stdio" : "http") as T, command: stdio ? "npx" : "", args: "", env: "", url: "", headers: "", via: (stdio ? "client" : "anthropic") as "client" | "anthropic" },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kv = (text: string) =>
    Object.fromEntries(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.search(/[=:]/);
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        transport: form.transport,
        command: form.transport !== "http" ? form.command : undefined,
        args: form.transport === "stdio" ? form.args.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, "")) ?? [] : [],
        env: kv(form.env),
        url: form.transport === "http" ? form.url : undefined,
        headers: kv(form.headers),
        via: form.transport === "http" ? form.via : undefined,
        enabled: initial ? initial.enabled : true,
      };
      if (initial) await api.put(`/api/mcp/${initial.id}`, payload);
      else await api.post("/api/mcp", payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={initial ? `Editar ${initial.name}` : "Adicionar servidor MCP"}>
      {!initial && <div className="mb-5">
        <div className="mb-2 text-[12px] text-ink-400">Modelos prontos</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              disabled={p.transport === "stdio" && !stdio}
              title={p.transport === "stdio" && !stdio ? "Precisa do servidor local (npm run dev)" : undefined}
              onClick={() =>
                setForm({
                  ...form,
                  name: p.name,
                  transport: p.transport,
                  command: "command" in p ? p.command : "",
                  args: "args" in p ? p.args : "",
                  url: "url" in p ? p.url : "",
                  headers: "headers" in p ? p.headers : "",
                  via: "via" in p ? p.via : form.via,
                })
              }
              className="rounded-xl border border-ink-700 bg-ink-900 p-2.5 text-left transition hover:border-mcp/40 hover:bg-mcp/5 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <div className="text-[12.5px] font-medium text-ink-100">{p.label}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">{p.note}</div>
            </button>
          ))}
        </div>
      </div>}
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome" hint="vira prefixo: mcp__nome__ferramenta">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex.: filesystem" />
          </Field>
          <Field label="Transporte">
            <Select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as T, command: e.target.value === "builtin" ? (health?.capabilities.builtinMcp[0] ?? "") : form.command })}>
              <option value="stdio" disabled={!stdio}>stdio — processo local{stdio ? "" : " (só no modo servidor)"}</option>
              <option value="http">HTTP — servidor remoto</option>
              <option value="builtin">embutido — roda em memória</option>
            </Select>
          </Field>
        </div>
        {form.transport === "builtin" ? (
          <Field label="Servidor embutido" hint="código em core/mcp/lab-server.ts">
            <Select value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}>
              {health?.capabilities.builtinMcp.map((b) => <option key={b}>{b}</option>)}
            </Select>
          </Field>
        ) : form.transport === "stdio" ? (
          <>
            <div className="grid gap-4 md:grid-cols-[160px_1fr]">
              <Field label="Comando">
                <Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} className="font-mono" />
              </Field>
              <Field label="Argumentos">
                <Input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} className="font-mono" placeholder="-y @modelcontextprotocol/server-everything" />
              </Field>
            </div>
            <Field label="Variáveis de ambiente" hint={initial ? "uma por linha: CHAVE=valor · •••• mantém o valor salvo" : "uma por linha: CHAVE=valor (ficam ocultas na UI)"}>
              <Textarea rows={2} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} className="font-mono text-[12px]" placeholder="GITHUB_TOKEN=..." />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="font-mono" placeholder="https://.../mcp" />
            </Field>
            <div className="rounded-xl border border-ink-700 p-3">
              <div className="mb-2 text-[12.5px] font-medium text-ink-200">Quem faz a conexão</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["anthropic", "API da Anthropic", "A própria API do Claude conecta ao servidor durante a execução. Funciona no site publicado (sem CORS), mas só com LLMs Anthropic e envia apenas o cabeçalho Authorization."],
                  ["client", "Agent Lab", "O Agent Lab conecta, lista as ferramentas e as executa. Funciona com qualquer LLM; no site publicado, o servidor precisa permitir CORS."],
                ] as const).map(([value, title, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm({ ...form, via: value })}
                    className={`rounded-lg border p-2.5 text-left transition ${form.via === value ? "border-accent/50 bg-accent/10" : "border-ink-700 hover:bg-ink-900"}`}
                  >
                    <div className="text-[12.5px] font-medium text-ink-100">{title}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-ink-400">{text}</div>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Cabeçalhos" hint={initial ? "um por linha: Nome: valor · •••• mantém o valor salvo" : "um por linha: Nome: valor"}>
              <Textarea rows={2} value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} className="font-mono text-[12px]" placeholder="Authorization: Bearer ..." />
            </Field>
          </>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={busy || !form.name}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {initial ? "Salvar e reconectar" : "Salvar e conectar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
