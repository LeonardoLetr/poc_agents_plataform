import { beforeAll, describe, expect, it } from "vitest";
import { bootCore, waitFor } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof bootCore>>;
let labId = "";

beforeAll(async () => {
  ctx = await bootCore();
  await waitFor(async () => {
    const lab = (await ctx.api("GET", "/api/mcp")).body.find((s: any) => s.name === "laboratorio");
    labId = lab?.id ?? "";
    return lab?.state.status === "connected";
  }, 5000, "MCP laboratorio");
});

describe("MCP: servidor embutido", () => {
  it("descobre as ferramentas via tools/list com nomes qualificados", async () => {
    const lab = (await ctx.api("GET", "/api/mcp")).body.find((s: any) => s.id === labId);
    expect(lab.state.serverInfo).toEqual({ name: "laboratorio", version: "1.0.0" });
    expect(lab.state.tools.map((t: any) => t.qualifiedName)).toEqual([
      "mcp__laboratorio__notas_adicionar",
      "mcp__laboratorio__notas_listar",
      "mcp__laboratorio__dados_rolar",
      "mcp__laboratorio__texto_estatisticas",
      "mcp__laboratorio__unidades_converter",
    ]);
  });

  it("executa tools/call e devolve o resultado", async () => {
    const res = await ctx.api("POST", `/api/mcp/${labId}/tools/unidades_converter/call`, { arguments: { valor: 100, conversao: "c->f" } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.text)).toMatchObject({ resultado: 212, unidade: "°F" });
    expect(res.body.isError).toBe(false);
  });

  it("mantém estado no servidor entre chamadas", async () => {
    await ctx.api("POST", `/api/mcp/${labId}/tools/notas_adicionar/call`, { arguments: { texto: "primeira" } });
    const list = await ctx.api("POST", `/api/mcp/${labId}/tools/notas_listar/call`, { arguments: {} });
    expect(JSON.parse(list.body.text)).toEqual([expect.objectContaining({ id: 1, text: "primeira" })]);
  });

  it("sinaliza argumentos inválidos como erro da ferramenta", async () => {
    const res = await ctx.api("POST", `/api/mcp/${labId}/tools/dados_rolar/call`, { arguments: { notacao: "muitos dados" } });
    expect(res.status === 400 || res.body.isError).toBe(true);
  });

  it("expõe as ferramentas MCP na lista geral", async () => {
    const tools = (await ctx.api("GET", "/api/tools")).body;
    expect(tools.find((t: any) => t.name === "mcp__laboratorio__dados_rolar")).toMatchObject({ source: "mcp", server: "laboratorio" });
  });

  it("desconecta e reconecta", async () => {
    expect((await ctx.api("POST", `/api/mcp/${labId}/disconnect`)).body.state.status).toBe("disconnected");
    expect((await ctx.api("POST", `/api/mcp/${labId}/connect`)).body.state.status).toBe("connected");
  });
});

describe("MCP: transporte stdio sem hospedeiro Node", () => {
  it("falha com mensagem explicativa quando o transporte não está registrado", async () => {
    const res = await ctx.api("POST", "/api/mcp", { name: "processo", transport: "stdio", command: "node", args: ["servidor.js"] });
    expect(res.status).toBe(201);
    expect(res.body.state.status).toBe("error");
    expect(res.body.state.error).toMatch(/só está disponível no modo servidor/);
  });

  it("rejeita nomes duplicados e inválidos", async () => {
    expect((await ctx.api("POST", "/api/mcp", { name: "laboratorio", transport: "builtin", command: "laboratorio" })).status).toBe(409);
    expect((await ctx.api("POST", "/api/mcp", { name: "nome com espaço", transport: "http", url: "https://x" })).status).toBe(400);
  });
});
