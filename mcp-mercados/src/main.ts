import { homedir } from "node:os";
import { join } from "node:path";
import { cacheEmArquivo } from "./cache.ts";
import { FONTES } from "./fontes.ts";
import { iniciar, ORIGENS_PADRAO } from "./servidor.ts";

const porta = Number(process.env.PORT ?? 3333);
const extras = (process.env.ORIGENS ?? "").split(",").filter(Boolean);
const cache = cacheEmArquivo(process.env.CACHE ?? join(homedir(), ".agent-lab", "mercados-cache.json"));

await iniciar({ fontes: FONTES, cache, agora: Date.now }, { porta, origens: [...ORIGENS_PADRAO, ...extras] });
console.log(`Servidor MCP de mercados em http://localhost:${porta}/mcp`);
console.log('No Agent Lab: "Servidores MCP" → "Servidor remoto (HTTP)", com esse endereço e "Quem faz a conexão" = "Agent Lab".');
