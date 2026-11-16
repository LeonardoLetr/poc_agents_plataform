import { CheckCircle2, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, ErrorNote, Modal } from "./ui";

type Collection = "llms" | "agents" | "prompts" | "mcpServers" | "memories";
const LABELS: Record<Collection, string> = { agents: "Agentes", llms: "LLMs", prompts: "Prompts", mcpServers: "Servidores MCP", memories: "Memórias" };
const ORDER: Collection[] = ["agents", "llms", "prompts", "mcpServers", "memories"];

interface ImportReport {
  mode: "merge" | "replace";
  counts: Record<Collection, { added: number; replaced: number; skipped: number }>;
  conflicts: { collection: Collection; id: string; name: string }[];
  warnings: string[];
}

/** Baixa a configuração atual como JSON (sem chaves de API nem valores de cabeçalhos). */
export async function downloadExport() {
  const data = await api.get<{ exportedAt: string }>("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agent-lab-${data.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Importação: escolher arquivo → conferir o conteúdo → mesclar ou substituir → relatório. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: Record<string, unknown> } | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setMode("merge");
    onClose();
  };

  async function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      const data = JSON.parse(await f.text()) as Record<string, unknown>;
      if (data.format !== "agent-lab-export") throw new Error("Este arquivo não é uma exportação do Agent Lab.");
      setFile({ name: f.name, data });
    } catch (e) {
      setError(e instanceof SyntaxError ? "O arquivo não é um JSON válido." : (e as Error).message);
    }
  }

  async function run() {
    if (!file) return;
    if (mode === "replace" && !confirm("Substituir toda a configuração atual pela do arquivo? Agentes, LLMs, prompts, servidores e memórias atuais serão trocados.")) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.post<ImportReport>("/api/import", { data: file.data, mode }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={report ? () => location.reload() : close} title="Importar configuração">
      {report ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] text-ok">
            <CheckCircle2 size={16} /> Importação concluída ({report.mode === "merge" ? "mesclar" : "substituir"}).
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.04em] text-ink-400">
                <th className="py-1 font-medium">Item</th>
                <th className="py-1 text-right font-medium">Adicionados</th>
                <th className="py-1 text-right font-medium">{report.mode === "merge" ? "Conflitos" : "Substituídos"}</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.map((c) => (
                <tr key={c} className="border-t border-ink-850 text-ink-200">
                  <td className="py-1.5">{LABELS[c]}</td>
                  <td className="py-1.5 text-right tabular-nums">{report.counts[c].added}</td>
                  <td className="py-1.5 text-right tabular-nums">{report.mode === "merge" ? report.counts[c].skipped : report.counts[c].replaced}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.conflicts.length > 0 && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-ink-200">Mantidos como estavam (já existiam com o mesmo id)</div>
              <div className="scroll-thin flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {report.conflicts.map((c) => (
                  <Badge key={`${c.collection}-${c.id}`}>
                    {LABELS[c.collection]}: {c.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {report.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
              {w}
            </p>
          ))}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => location.reload()}>
              Concluir
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <button
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-ink-600 px-4 py-5 text-[12.5px] text-ink-300 transition hover:border-ink-500 hover:text-ink-100"
          >
            <Upload size={18} />
            {file ? <span className="font-medium text-ink-100">{file.name}</span> : "Escolher arquivo exportado (.json)"}
          </button>
          {file && (
            <>
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                {ORDER.map((c) => (
                  <Badge key={c}>
                    {LABELS[c]}: {Array.isArray(file.data[c]) ? (file.data[c] as unknown[]).length : 0}
                  </Badge>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["merge", "Mesclar", "Adiciona o que é novo e mantém o que já existe. Itens repetidos aparecem como conflitos."],
                  ["replace", "Substituir", "Troca toda a configuração pela do arquivo. As chaves das LLMs com o mesmo id são mantidas."],
                ] as const).map(([value, title, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`rounded-lg border p-2.5 text-left transition ${mode === value ? "border-accent/50 bg-accent/10" : "border-ink-700 hover:bg-ink-900"}`}
                  >
                    <div className="text-[12.5px] font-medium text-ink-100">{title}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-ink-400">{text}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11.5px] text-ink-400">Chaves de API e valores de cabeçalhos não fazem parte do arquivo: informe-os depois em “LLMs” e “Servidores MCP”.</p>
            </>
          )}
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancelar</Button>
            <Button variant="primary" onClick={run} disabled={!file || busy}>
              <Download size={14} className="rotate-180" /> Importar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
