import { z } from "zod";

/** Tipos do servidor de preços: redes atendidas, ofertas encontradas e o contrato de cada fonte. */

export const REDES = ["tauste", "carrefour", "assai", "atacadao"] as const;
export type Rede = (typeof REDES)[number];

export const NOMES_REDES: Record<Rede, string> = {
  tauste: "Tauste",
  carrefour: "Carrefour",
  assai: "Assaí",
  atacadao: "Atacadão",
};

/** Oferta encontrada numa fonte. O mesmo esquema valida o que volta do cache em arquivo. */
export const Oferta = z.object({
  rede: z.enum(REDES),
  /** Nome como aparece na fonte (encarte ou loja online). */
  nome: z.string(),
  preco: z.number(),
  /** Unidade em que o preço é cobrado. Em "pacote", `quantidadeGramas` diz quanto vem na embalagem, quando informado. */
  unidade: z.enum(["kg", "unidade", "bandeja", "pacote"]),
  quantidadeGramas: z.number().optional(),
  /** Preço promocional (encarte), não o preço normal da loja. */
  promocao: z.boolean(),
  /** Último dia da oferta (AAAA-MM-DD), quando a fonte informa. */
  validade: z.string().optional(),
  /** Exige clube de vantagens ou cartão da rede. */
  condicao: z.string().optional(),
  loja: z.string().optional(),
  /** Onde o preço foi lido. */
  fonte: z.string(),
});
export type Oferta = z.infer<typeof Oferta>;

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Busca as ofertas de uma rede para os produtos pedidos, na região do CEP. Falhas esperadas voltam como valor. */
export type Fonte = {
  rede: Rede;
  buscar(produtos: readonly string[], cep: string, signal: AbortSignal): Promise<Resultado<Oferta[]>>;
};
