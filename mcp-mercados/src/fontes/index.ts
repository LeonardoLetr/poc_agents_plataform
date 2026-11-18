import type { Cache } from "../cache.ts";
import type { Fonte, Rede } from "../tipos.ts";
import { fonteAssai } from "./assai.ts";
import { atacadao } from "./atacadao.ts";
import { carrefour } from "./carrefour.ts";
import { tauste } from "./tauste.ts";

/** Uma fonte por rede. A do Assaí precisa do cache e, para ler os encartes em imagem, da chave da Anthropic. */
export function fontes(deps: { cache: Cache; agora: () => number; chaveApi: string | undefined; modelo: string }): Record<Rede, Fonte> {
  return { tauste, carrefour, atacadao, assai: fonteAssai(deps) };
}
