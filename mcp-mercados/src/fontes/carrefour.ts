import type { Fonte, Oferta } from "../tipos.ts";
import { baixar, lerPreco, unidadeDoNome } from "./comum.ts";

/**
 * Carrefour: as APIs da loja recusam chamadas automáticas, mas a página de busca traz os cartões de produto no HTML.
 * Sem escolher o CEP, os preços são os da loja online na região padrão.
 */

const SITE = "https://mercado.carrefour.com.br";

/** Cartões `search-product-card`: nome no <h2>; com desconto, preço antigo + porcentagem + preço novo. */
export function ofertasCarrefour(html: string): Oferta[] {
  const inicios = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-testid="search-product-card"/g)];
  return inicios.flatMap((m, i) => {
    const fim = inicios[i + 1]?.index ?? html.length;
    const cartao = html.slice(m.index, fim);
    const nome = /<h2[^>]*>([^<]+)<\/h2>/.exec(cartao)?.[1]?.replace(/\s+/g, " ").trim();
    if (!nome) return [];
    // Só os preços em <span>: o preço por kg vem num <p> e é recalculado a partir do peso.
    const precos = [...cartao.matchAll(/<span[^>]*>(R\$\s?[\d.,]+)<\/span>/g)].flatMap((p) => {
      const valor = p[1] ? lerPreco(p[1]) : undefined;
      return valor === undefined ? [] : [valor];
    });
    const desconto = /-<!-- -->\d+<!-- -->%/.test(cartao);
    const preco = desconto ? precos[1] : precos[0];
    if (preco === undefined) return [];
    return [
      {
        rede: "carrefour" as const,
        nome,
        preco,
        ...unidadeDoNome(nome),
        promocao: desconto,
        loja: "loja online (região padrão)",
        fonte: `${SITE}${m[1] ?? ""}`,
      },
    ];
  });
}

export const carrefour: Fonte = {
  rede: "carrefour",
  async buscar(produtos, _local, signal) {
    const ofertas: Oferta[] = [];
    for (const produto of produtos) {
      const r = await baixar(`${SITE}/busca/${encodeURIComponent(produto)}`, signal);
      if (!r.ok) return { ok: false, erro: `busca falhou (${r.erro})` };
      ofertas.push(...ofertasCarrefour(r.valor));
    }
    return { ok: true, valor: ofertas };
  },
};
