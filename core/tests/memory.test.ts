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

describe("memória de longo prazo", () => {
  it("cria, recupera por relevância e detalha a pontuação", async () => {
    const created = await ctx.api("POST", "/api/memories", { content: "O deploy usa GitHub Actions e Pages", kind: "fact", importance: 5, tags: ["deploy"] });
    expect(created.status).toBe(201);

    const results = mem.searchMemories("como funciona o deploy no github");
    expect(results[0].memory.id).toBe(created.body.id);
    expect(results[0].breakdown.overlap).toBeGreaterThan(0);
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
