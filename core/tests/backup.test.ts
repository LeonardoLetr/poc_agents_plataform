import { describe, expect, it } from "vitest";
import { bootCore } from "./helpers.js";

describe("exportar e importar configuração", () => {
  it("exporta sem chaves de API, sem valores de cabeçalhos e sem execuções", async () => {
    const { api, db } = await bootCore();
    await api("PUT", "/api/llms/llm_claude_opus", { ...db.llms.find((l) => l.id === "llm_claude_opus")!, apiKey: "sk-ant-segredo" });
    await api("POST", "/api/mcp", { name: "zapier", transport: "http", url: "https://mcp.zapier.com/api/v1/connect", headers: { Authorization: "Bearer token-secreto" }, via: "anthropic" });

    const res = await api("GET", "/api/export");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ format: "agent-lab-export", version: db.version });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("sk-ant-segredo");
    expect(text).not.toContain("token-secreto");
    expect(res.body.mcpServers.find((s: { name: string }) => s.name === "zapier").headers).toEqual({ Authorization: "" });
    expect(res.body).not.toHaveProperty("runs");
    expect(res.body).not.toHaveProperty("audit");
    expect(res.body.agents.length).toBe(db.agents.length);
  });

  it("mesclar adiciona o que é novo e lista os conflitos", async () => {
    const { api, db } = await bootCore();
    const file = (await api("GET", "/api/export")).body;
    file.agents.push({ ...file.agents[0], id: "agt_importado", name: "Agente importado" });
    file.prompts = [];

    const res = await api("POST", "/api/import", { data: file, mode: "merge" });
    expect(res.status).toBe(200);
    expect(res.body.counts.agents).toEqual({ added: 1, replaced: 0, skipped: file.agents.length - 1 });
    expect(res.body.conflicts.some((c: { collection: string; id: string }) => c.collection === "agents" && c.id === file.agents[0].id)).toBe(true);
    expect(db.agents.some((a) => a.id === "agt_importado")).toBe(true);
    // LLMs mantidas (conflitos) não geram aviso de chave; só as que entraram pelo arquivo.
    expect(res.body.warnings.some((w: string) => w.includes("Informe a chave"))).toBe(false);
  });

  it("substituir troca a configuração, preserva chaves das mesmas LLMs e corrige referências", async () => {
    const { api, db } = await bootCore();
    await api("PUT", "/api/llms/llm_claude_opus", { ...db.llms.find((l) => l.id === "llm_claude_opus")!, apiKey: "sk-ant-mantida" });
    const file = (await api("GET", "/api/export")).body;
    file.agents = [{ ...file.agents[0], id: "agt_unico", name: "Único", llmId: "llm_inexistente" }];

    const res = await api("POST", "/api/import", { data: file, mode: "replace" });
    expect(res.status).toBe(200);
    expect(db.agents.map((a) => a.id)).toEqual(["agt_unico"]);
    expect(db.agents[0].llmId).toBe("llm_demo");
    expect(db.llms.find((l) => l.id === "llm_claude_opus")!.apiKey).toBe("sk-ant-mantida");
    expect(res.body.warnings.some((w: string) => w.includes("Único"))).toBe(true);
    expect(db.audit.some((a) => a.summary.startsWith("Configuração importada"))).toBe(true);
  });

  it("rejeita arquivos que não são exportações ou de versão mais nova", async () => {
    const { api, db } = await bootCore();
    const wrong = await api("POST", "/api/import", { data: { qualquer: true }, mode: "merge" });
    expect(wrong.status).toBe(400);
    const future = await api("POST", "/api/import", { data: { format: "agent-lab-export", version: db.version + 1 }, mode: "merge" });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/versão mais nova/);
  });
});
