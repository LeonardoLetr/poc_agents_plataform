// Conteúdo e grafo compartilhados pelos 5 conceitos: o mesmo dado, estilos diferentes.
window.LAB = {
  nav: ["Visão geral", "Playground", "Agentes", "LLMs", "Servidores MCP", "Memória", "Prompts", "Auditoria", "Aprender"],
  task: "Quanto é (1250 × 1,08)² e que horas são agora? Role 2d20.",
  metrics: [
    ["Iterações", "4"],
    ["Tokens entrada", "4.208"],
    ["Tokens saída", "344"],
    ["Ferramentas", "5"],
  ],
};

/** Desenha o grafo do agente dentro de `el`. Os estilos vêm do CSS de cada conceito. */
window.renderGraph = function (el, opts = {}) {
  const nodes = [
    { id: "user", label: "Usuário", sub: "tarefa", x: 9, y: 50, kind: "user" },
    { id: "llm", label: "Pesquisador", sub: "Claude Opus 5.5", x: 42, y: 48, kind: "agent" },
    { id: "scratch", label: "Scratchpad", sub: "memória de trabalho", x: 42, y: 10, kind: "memory" },
    { id: "memory", label: "Memória", sub: "fatos · episódios", x: 42, y: 88, kind: "memory" },
    { id: "calc", label: "calculator", sub: "nativa · 1×", x: 82, y: 18, kind: "tool", active: true },
    { id: "time", label: "current_time", sub: "nativa · 1×", x: 82, y: 40, kind: "tool" },
    { id: "fetch", label: "http_fetch", sub: "nativa", x: 82, y: 62, kind: "tool" },
    { id: "mcp", label: "laboratorio", sub: "MCP · 5 ferramentas", x: 82, y: 84, kind: "mcp" },
  ];
  const edges = [["user", "llm"], ["llm", "scratch"], ["llm", "memory"], ["llm", "calc"], ["llm", "time"], ["llm", "fetch"], ["llm", "mcp"]];
  el.style.position = "relative";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "g-edges");
  Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "visible" });
  el.appendChild(svg);
  const els = {};
  for (const n of nodes) {
    const d = document.createElement("div");
    d.className = `g-node g-${n.kind}${n.active ? " is-active" : ""}`;
    d.style.cssText = `position:absolute;left:${n.x}%;top:${n.y}%;transform:translate(-50%,-50%)`;
    d.innerHTML =
      n.kind === "agent"
        ? `<div class="g-orb">${opts.agentIcon ?? "🔎"}</div><div class="g-label">${n.label}</div><div class="g-sub">${n.sub}</div><div class="g-state">${opts.state ?? "Pensando…"}</div>`
        : `<div class="g-icon">${opts.icons?.[n.kind] ?? "●"}</div><div><div class="g-label">${n.label}</div><div class="g-sub">${n.sub}</div></div>`;
    el.appendChild(d);
    els[n.id] = d;
  }
  requestAnimationFrame(() => {
    const box = el.getBoundingClientRect();
    const c = (id, side) => {
      const r = els[id].getBoundingClientRect();
      const x = side === "l" ? r.left : side === "r" ? r.right : r.left + r.width / 2;
      const y = side === "t" ? r.top : side === "b" ? r.bottom : r.top + r.height / 2;
      return [x - box.left, y - box.top];
    };
    for (const [a, b] of edges) {
      const vertical = b === "scratch" || b === "memory";
      const [x1, y1] = vertical ? c(a, b === "scratch" ? "t" : "b") : c(a, "r");
      const [x2, y2] = vertical ? c(b, b === "scratch" ? "b" : "t") : c(b, "l");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const dpath = vertical ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
      p.setAttribute("d", dpath);
      const active = b === "calc";
      p.setAttribute("class", `g-edge${active ? " is-on" : ""}`);
      svg.appendChild(p);
      if (active) {
        for (const t of [0.35, 0.7]) {
          const len = p.getTotalLength();
          const pt = p.getPointAtLength(len * t);
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", pt.x);
          dot.setAttribute("cy", pt.y);
          dot.setAttribute("r", opts.dotR ?? 4);
          dot.setAttribute("class", "g-dot");
          svg.appendChild(dot);
        }
      }
    }
  });
};
