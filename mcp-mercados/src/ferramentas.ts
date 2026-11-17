import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chave, type Cache } from "./cache.ts";
import { comparar } from "./comparacao.ts";
import { NOMES_REDES, REDES, type Fonte, type Oferta, type Rede } from "./tipos.ts";

export type Dependencias = {
  fontes: Record<Rede, Fonte>;
  cache: Cache;
  agora: () => number;
};

/** Tempo máximo de busca em cada rede: uma rede lenta não segura a resposta das outras. */
const LIMITE_POR_REDE_MS = 20_000;

/** Ofertas de uma rede para os produtos pedidos: o que estiver no cache não vai à fonte. */
async function ofertasDaRede(deps: Dependencias, rede: Rede, cep: string, produtos: readonly string[]) {
  const agora = deps.agora();
  const doCache: Oferta[] = [];
  const faltando: string[] = [];
  for (const produto of produtos) {
    const salvas = await deps.cache.ler(chave(rede, cep, produto), agora);
    if (salvas) doCache.push(...salvas);
    else faltando.push(produto);
  }
  if (!faltando.length) return { rede, ofertas: doCache, erro: undefined };

  const resultado = await deps.fontes[rede].buscar(faltando, cep, AbortSignal.timeout(LIMITE_POR_REDE_MS));
  if (!resultado.ok) return { rede, ofertas: doCache, erro: resultado.erro };
  // Cada produto guarda só as ofertas que correspondem a ele, inclusive a ausência delas (o encarte não tem o item).
  for (const { produto, ofertas } of comparar(faltando, resultado.valor))
    await deps.cache.gravar(chave(rede, cep, produto), ofertas, agora);
  return { rede, ofertas: [...doCache, ...resultado.valor], erro: undefined };
}

export function criarServidor(deps: Dependencias): McpServer {
  const server = new McpServer({ name: "mercados", version: "0.1.0" });

  server.registerTool(
    "listar_redes",
    { title: "Listar redes", description: "Lista as redes de supermercado atendidas por este servidor.", inputSchema: {} },
    () => ({ content: [{ type: "text", text: REDES.map((r) => `${r}: ${NOMES_REDES[r]}`).join("\n") }] }),
  );

  server.registerTool(
    "buscar_precos",
    {
      title: "Buscar preços",
      description:
        "Busca os preços dos produtos nas grandes redes de supermercado da região do CEP e devolve, por produto, as ofertas " +
        "da mais barata para a mais cara (com preço por kg quando dá para calcular). Preços de encarte são promoções da semana.",
      inputSchema: {
        cep: z.string().regex(/^\d{5}-?\d{3}$/, "CEP com 8 dígitos, ex.: 18010-000"),
        produtos: z.array(z.string().min(2)).min(1).max(20).describe("Produtos da lista de compras, ex.: banana prata, maçã"),
        redes: z.array(z.enum(REDES)).optional().describe("Redes a consultar; sem informar, todas."),
      },
    },
    async ({ cep, produtos, redes }) => {
      const porRede = await Promise.all((redes ?? REDES).map((r) => ofertasDaRede(deps, r, cep, produtos)));
      const resposta = {
        cep,
        consultadoEm: new Date(deps.agora()).toISOString(),
        produtos: comparar(
          produtos,
          porRede.flatMap((r) => r.ofertas),
        ),
        avisos: porRede.flatMap((r) => (r.erro ? [`${NOMES_REDES[r.rede]}: ${r.erro}`] : [])),
      };
      return { content: [{ type: "text", text: JSON.stringify(resposta, null, 2) }] };
    },
  );

  return server;
}
