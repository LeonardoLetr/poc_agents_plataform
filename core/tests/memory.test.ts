import { beforeAll, describe, expect, it } from "vitest";
import { bootCore } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;
let mem: typeof import("../memory.js");

beforeAll(async () => {
  ctx = await bootCore();
  mem = await import("../memory.js");
});

describe("tokenização", () => {
  it("normaliza acentos, caixa e remove palavras vazias", () => {
    expect(mem.tokenize("O Usuário prefere Café")).toEqual(["usuario", "prefere", "cafe"]);
  });
});

describe("radicais e similaridade", () => {
  it("reduz flexões comuns ao mesmo radical", () => {
    expect(mem.stem("agentes")).toBe(mem.stem("agente"));
    expect(mem.stem("ferramentas")).toBe(mem.stem("ferramenta"));
    expect(mem.stem("calculando")).toBe("calcul");
    expect(mem.stem("mcp")).toBe("mcp"); // palavras curtas ficam intactas
  });

  it("dá similaridade parcial a radicais com prefixo comum", () => {
    expect(mem.termSimilarity("prefir", "prefer")).toBeCloseTo(4 / 6);
    expect(mem.termSimilarity("agent", "agent")).toBe(1);
    expect(mem.termSimilarity("cafe", "casa")).toBe(0);
  });
});

describe("memória de longo prazo", () => {
  it("cria, recupera por relevância e detalha a pontuação", async () => {
    const created = await ctx.api("POST", "/api/memories", { content: "O deploy usa GitHub Actions e Pages", kind: "fact", importance: 5, tags: ["deploy"] });
    expect(created.status).toBe(201);

    const results = mem.searchMemories("como funciona o deploy no github");
    expect(results[0].memory.id).toBe(created.body.id);
    expect(results[0].breakdown.relevance).toBe(1); // o mais relevante é a referência da normalização
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("não retorna memórias sem termos em comum", () => {
    expect(mem.searchMemories("xilofone quântico")).toHaveLength(0);
  });

  it("respeita o escopo: memória de um agente não aparece para outro", () => {
    mem.createMemory({ content: "Senha do cofre do agente A é azul", agentId: "agt_a", source: "agent" });
    expect(mem.searchMemories("cofre senha", { agentId: "agt_a" })).toHaveLength(1);
    expect(mem.searchMemories("cofre senha", { agentId: "agt_b" })).toHaveLength(0);
  });

  it("registra acesso quando a busca marca uso (touch)", () => {
    const [first] = mem.searchMemories("deploy github", { touch: true });
    expect(first.memory.accessCount).toBe(1);
    expect(first.memory.lastAccessedAt).not.toBeNull();
  });

  it("edita e remove pela API, registrando na auditoria", async () => {
    const { body } = await ctx.api("POST", "/api/memories", { content: "temporária", kind: "fact" });
    const edited = await ctx.api("PUT", `/api/memories/${body.id}`, { content: "editada", kind: "procedure", importance: 2 });
    expect(edited.body.kind).toBe("procedure");
    expect((await ctx.api("DELETE", `/api/memories/${body.id}`)).status).toBe(200);
    expect((await ctx.api("DELETE", `/api/memories/${body.id}`)).status).toBe(404);
    const types = ctx.db.audit.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["memory.created", "memory.updated", "memory.deleted"]));
  });
});

describe("ranking BM25", () => {
  it("encontra variações da mesma palavra (prefiro × prefere, plural × singular)", () => {
    mem.createMemory({ content: "O usuário prefere relatórios curtos", kind: "preference", source: "user" });
    const hits = mem.searchMemories("eu prefiro relatório").map((r) => r.memory.content);
    expect(hits[0]).toBe("O usuário prefere relatórios curtos");
  });

  it("valoriza termos raros acima de termos comuns", () => {
    for (let i = 0; i < 4; i++) mem.createMemory({ content: `Nota genérica ${i} sobre projeto`, source: "user", importance: 3 });
    mem.createMemory({ content: "Projeto usa banco Postgres", source: "user", importance: 3 });
    const [top] = mem.searchMemories("projeto postgres");
    expect(top.memory.content).toBe("Projeto usa banco Postgres");
  });

  it("permite excluir tipos de memória da busca", () => {
    mem.createMemory({ content: "Episódio sobre orçamento trimestral", kind: "episode", source: "auto" });
    expect(mem.searchMemories("orçamento trimestral").some((r) => r.memory.kind === "episode")).toBe(true);
    expect(mem.searchMemories("orçamento trimestral", { excludeKinds: ["episode"] })).toHaveLength(0);
  });
});
