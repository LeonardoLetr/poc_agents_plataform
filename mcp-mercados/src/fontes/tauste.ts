import { z } from "zod";
import type { Fonte, Oferta } from "../tipos.ts";
import { baixar, lerJson, lojaMaisProxima, mesmaCidade, unidadeDoNome } from "./comum.ts";

/**
 * Tauste: loja online em Magento, com uma "loja" por unidade física (ex.: sorocaba1 = Campolim). A lista de lojas vem
 * na página inicial; os preços, da API GraphQL da loja escolhida, com preço normal e final (promoção quando menor).
 */

const SITE = "https://tauste.com.br";

export type LojaTauste = { codigo: string; nome: string; cidade: string; cep: string };

/** Lojas descritas no JSON embutido da página inicial (com aspas e acentos escapados). */
export function lojasTauste(html: string): LojaTauste[] {
  const texto = html.replace(/\\u0022/g, '"').replace(/\\\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const lojas = new Map<string, LojaTauste>();
  for (const m of texto.matchAll(/\{[^{}]*"city_zip_code":"(\d{8})"[^{}]*\}/g)) {
    const campo = (nome: string) => new RegExp(`"${nome}":"([^"]*)"`).exec(m[0])?.[1]?.trim();
    const codigo = campo("code");
    const cidade = campo("city");
    if (codigo && cidade && m[1]) lojas.set(codigo, { codigo, nome: campo("store_view_name") ?? codigo, cidade, cep: m[1] });
  }
  return [...lojas.values()];
}

const Resposta = z.object({
  data: z.object({
    products: z.object({
      items: z.array(
        z.object({
          name: z.string(),
          url_key: z.string(),
          price_range: z.object({
            minimum_price: z.object({ regular_price: z.object({ value: z.number() }), final_price: z.object({ value: z.number() }) }),
          }),
        }),
      ),
    }),
  }),
});

/** Ofertas da resposta GraphQL de uma busca. */
export function ofertasTauste(json: unknown, loja: LojaTauste): Oferta[] {
  const lido = Resposta.safeParse(json);
  if (!lido.success) return [];
  return lido.data.data.products.items.flatMap((p) => {
    const { regular_price, final_price } = p.price_range.minimum_price;
    if (final_price.value <= 0) return [];
    return [
      {
        rede: "tauste" as const,
        nome: p.name,
        preco: final_price.value,
        ...unidadeDoNome(p.name),
        promocao: final_price.value < regular_price.value,
        loja: loja.nome,
        fonte: `${SITE}/${loja.codigo}/${p.url_key}.html`,
      },
    ];
  });
}

const consulta = (termo: string) =>
  JSON.stringify({
    query: `{ products(search: ${JSON.stringify(termo)}, pageSize: 10) { items { name url_key price_range { minimum_price { regular_price { value } final_price { value } } } } } }`,
  });

export const tauste: Fonte = {
  rede: "tauste",
  async buscar(produtos, local, signal) {
    const pagina = await baixar(`${SITE}/`, signal);
    if (!pagina.ok) return { ok: false, erro: `lista de lojas indisponível (${pagina.erro})` };
    const loja = lojaMaisProxima(
      lojasTauste(pagina.valor).filter((l) => mesmaCidade(l.cidade, local.cidade)),
      local.cep,
    );
    if (!loja) return { ok: false, erro: `nenhuma loja em ${local.cidade}` };
    const ofertas: Oferta[] = [];
    for (const produto of produtos) {
      const r = await baixar(`${SITE}/graphql`, signal, {
        method: "POST",
        headers: { "content-type": "application/json", store: loja.codigo },
        body: consulta(produto),
      });
      if (!r.ok) return { ok: false, erro: `busca falhou (${r.erro})` };
      ofertas.push(...ofertasTauste(lerJson(r.valor), loja));
    }
    return { ok: true, valor: ofertas };
  },
};
