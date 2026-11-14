import type { ReactNode } from "react";

/** Renderizador de Markdown mínimo (negrito, itálico, código, listas, citações, títulos, links). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<!\w)_[^_\n]+_(?!\w)|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink-100">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-cyan">{t.slice(1, -1)}</code>);
    else if (t.startsWith("_")) out.push(<em key={k} className="text-ink-300">{t.slice(1, -1)}</em>);
    else if (t.startsWith("[")) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      // Só links http(s): o texto vem do modelo e não deve poder injetar `javascript:`.
      if (!/^https?:\/\//.test(href)) out.push(label);
      else out.push(<a key={k} href={href} target="_blank" rel="noreferrer" className="text-cyan underline decoration-cyan/30 underline-offset-2 hover:decoration-cyan">{label}</a>);
    } else out.push(<a key={k} href={t} target="_blank" rel="noreferrer" className="break-all text-cyan underline decoration-cyan/30 underline-offset-2">{t}</a>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`} className="my-2 space-y-1 pl-4">{list}</ul>);
    list = [];
  };
  lines.forEach((line, idx) => {
    const k = `l${idx}`;
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(<pre key={k} className="my-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-xs text-ink-200">{code.join("\n")}</pre>);
        code = null;
      } else {
        flush();
        code = [];
      }
      return;
    }
    if (code) return void code.push(line);
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (li) {
      list.push(
        <li key={k} className={`relative pl-3 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-violet ${li[1].length ? "ml-4" : ""}`}>
          {inline(li[3], k)}
        </li>,
      );
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) blocks.push(<div key={k} className="mt-3 mb-1 font-semibold text-ink-100">{inline(h[2], k)}</div>);
    else if (line.startsWith(">")) blocks.push(<blockquote key={k} className="my-2 border-l-2 border-violet/50 pl-3 text-ink-300">{inline(line.replace(/^>\s?/, ""), k)}</blockquote>);
    else blocks.push(<p key={k} className="my-1.5">{inline(line, k)}</p>);
  });
  flush();
  return <div className={`text-[14px] leading-relaxed text-ink-200 ${className}`}>{blocks}</div>;
}
