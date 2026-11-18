import { homedir } from "node:os";
import { join } from "node:path";
import { cacheEmArquivo } from "./cache.ts";
import { fontes } from "./fontes/index.ts";
import { iniciar, ORIGENS_PADRAO } from "./servidor.ts";

const porta = Number(process.env.PORT ?? 3333);
const extras = (process.env.ORIGENS ?? "").split(",").filter(Boolean);
const cache = cacheEmArquivo(process.env.CACHE ?? join(homedir(), ".agent-lab", "mercados-cache.json"));

const agora = Date.now;
// A chave da Anthropic é opcional: só serve para ler os encartes que existem apenas em imagem (Assaí).
const chaveApi = process.env.ANTHROPIC_API_KEY || undefined;
const modelo = process.env.MODELO_ENCARTE ?? "claude-haiku-5-5";

await iniciar({ fontes: fontes({ cache, agora, chaveApi, modelo }), cache, agora }, { porta, origens: [...ORIGENS_PADRAO, ...extras] });
console.log(`Servidor MCP de mercados em http://localhost:${porta}/mcp`);
if (!chaveApi) console.log("Sem ANTHROPIC_API_KEY: os encartes do Assaí (só em imagem) aparecem como aviso, sem preços.");
console.log('No Agent Lab: "Servidores MCP" → "Servidor remoto (HTTP)", com esse endereço e "Quem faz a conexão" = "Agent Lab".');
