import { z } from "zod";
import type { Fonte, Oferta } from "../tipos.ts";
import { baixar, lerJson, unidadeDoNome } from "./comum.ts";

/**
 * Atacadão: loja online na VTEX, com a busca pública de catálogo. Itens vendidos a quilo vêm com o preço por kg.
 * A API devolve o preço da loja online, sem diferenciar a loja física da região.
 */

const SITE = "https://www.atacadao.com.br";

const Produtos = z.array(
  z.object({
    productName: z.string(),
    link: z.string(),
    items: z.array(
      z.object({
        measurementUnit: z.string().optional(),
        sellers: z.array(z.object({ commertialOffer: z.object({ Price: z.number(), ListPrice: z.number() }) })),
      }),
    ),
  }),
);

export function ofertasAtacadao(json: unknown): Oferta[] {
  const lido = Produtos.safeParse(json);
  if (!lido.success) return [];
  return lido.data.flatMap((p) => {
    const item = p.items[0];
    const oferta = item?.sellers[0]?.commertialOffer;
    // Preço zero = indisponível na loja online.
    if (!item || !oferta || oferta.Price <= 0) return [];
    return [
      {
        rede: "atacadao" as const,
        nome: p.productName,
        preco: oferta.Price,
        ...(item.measurementUnit === "kg" ? { unidade: "kg" as const } : unidadeDoNome(p.productName)),
        promocao: oferta.Price < oferta.ListPrice,
        loja: "loja online",
        fonte: p.link,
      },
    ];
  });
}

export const atacadao: Fonte = {
  rede: "atacadao",
  async buscar(produtos, _local, signal) {
    const ofertas: Oferta[] = [];
    for (const produto of produtos) {
      const r = await baixar(`${SITE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(produto)}&_from=0&_to=9`, signal);
      if (!r.ok) return { ok: false, erro: `busca falhou (${r.erro})` };
      ofertas.push(...ofertasAtacadao(lerJson(r.valor)));
    }
    return { ok: true, valor: ofertas };
  },
};
