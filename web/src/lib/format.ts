export const fmtNumber = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtUsd = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(n);
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
export const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

/** Rótulo amigável para ferramentas (tira o prefixo MCP). */
export function toolLabel(name: string): { label: string; server?: string } {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { label: m[2], server: m[1] } : { label: name };
}

export const kindLabel: Record<string, string> = {
  fact: "fato",
  episode: "episódio",
  preference: "preferência",
  procedure: "procedimento",
};
