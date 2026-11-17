import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { criarServidor, type Dependencias } from "./ferramentas.ts";

/**
 * Servidor HTTP do MCP de mercados, para rodar no computador do usuário. A página do Agent Lab (GitHub Pages) roda no
 * navegador da mesma máquina e conecta direto em http://localhost, sem nada exposto na internet.
 */

/** Origens que podem chamar o servidor pelo navegador: o site publicado e o ambiente de desenvolvimento. */
export const ORIGENS_PADRAO = ["https://leonardoletr.github.io", "http://localhost:5173", "http://localhost:4173"];

function cors(req: IncomingMessage, res: ServerResponse, origens: readonly string[]): boolean {
  const origem = req.headers.origin;
  // Sem Origin: cliente fora do navegador (Claude Desktop, testes). Origem desconhecida é recusada para que outro
  // site aberto no navegador não use o servidor local.
  if (origem === undefined) return true;
  if (!origens.includes(origem)) return false;
  res.setHeader("Access-Control-Allow-Origin", origem);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  // O Chrome só deixa um site público chamar um endereço local quando o servidor autoriza explicitamente.
  if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}

async function atender(req: IncomingMessage, res: ServerResponse, deps: Dependencias, origens: readonly string[]) {
  if (!cors(req, res, origens)) {
    res.writeHead(403).end("Origem não autorizada.");
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const caminho = new URL(req.url ?? "/", "http://localhost").pathname;
  if (caminho !== "/mcp") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Servidor MCP de mercados. Conecte o Agent Lab em /mcp.");
    return;
  }
  // Sem sessão (sem gerador de id): cada requisição recebe um servidor novo, e o estado que importa (o cache) fica fora dele.
  const server = criarServidor(deps);
  const transport = new StreamableHTTPServerTransport({});
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function iniciar(deps: Dependencias, opts: { porta: number; origens?: readonly string[] }): Promise<Server> {
  const origens = opts.origens ?? ORIGENS_PADRAO;
  const http = createServer((req, res) => {
    atender(req, res, deps, origens).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end("Erro interno do servidor MCP.");
    });
  });
  return new Promise((resolve) => http.listen(opts.porta, "127.0.0.1", () => resolve(http)));
}
