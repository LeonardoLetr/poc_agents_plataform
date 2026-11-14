import { prettyJson } from "../lib/format";

/** JSON com realce de sintaxe simples. */
export function JsonView({ value, className = "", maxHeight = 260 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = prettyJson(value);
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
      let cls = "text-warn";
      if (m.startsWith('"')) cls = m.endsWith(":") ? "text-accent" : "text-ok";
      else if (/true|false/.test(m)) cls = "text-info";
      else if (m === "null") cls = "text-ink-400";
      return `<span class="${cls}">${m}</span>`;
    });
  return (
    <pre
      className={`overflow-auto rounded-xl border border-black/[0.04] bg-ink-900 p-3 font-mono text-[11.5px] leading-relaxed text-ink-300 ${className}`}
      style={{ maxHeight }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
