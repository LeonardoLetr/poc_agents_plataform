import { NOMES_REDES, type Fonte, type Rede } from "./tipos.ts";

/**
 * Uma fonte por rede. Cada rede publica os preços de um jeito (loja online, página de ofertas, encarte em PDF);
 * a fonte de cada uma é implementada depois do mapeamento do site.
 */

const pendente = (rede: Rede): Fonte => ({
  rede,
  buscar: async () => ({ ok: false, erro: `A fonte de preços do ${NOMES_REDES[rede]} ainda não foi implementada.` }),
});

export const FONTES: Record<Rede, Fonte> = {
  tauste: pendente("tauste"),
  carrefour: pendente("carrefour"),
  assai: pendente("assai"),
  atacadao: pendente("atacadao"),
};
