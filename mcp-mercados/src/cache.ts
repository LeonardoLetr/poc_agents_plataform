import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { normalizar } from "./comparacao.ts";
import { Oferta, type Rede } from "./tipos.ts";

/**
 * Cache em arquivo das ofertas por rede, região e produto. Encartes valem a semana: a primeira consulta busca na
 * fonte e as seguintes saem daqui, até o fim da oferta (no máximo 7 dias).
 */

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

const Entrada = z.object({ expiraEm: z.number(), ofertas: z.array(Oferta) });
const Arquivo = z.record(z.string(), Entrada);
type Entrada = z.infer<typeof Entrada>;

/** A região é o prefixo de 5 dígitos do CEP: lojas próximas compartilham o mesmo encarte. */
export const chave = (rede: Rede, cep: string, produto: string) => `${rede}|${cep.replace(/\D/g, "").slice(0, 5)}|${normalizar(produto)}`;

/** Até o fim do último dia da oferta que vence primeiro; sem validade informada, uma semana. Nunca mais que uma semana. */
export function expiracao(ofertas: readonly Pick<Oferta, "validade">[], agora: number): number {
  const limite = agora + SEMANA_MS;
  const fins = ofertas.flatMap((o) => (o.validade ? [Date.parse(`${o.validade}T23:59:59`)] : [])).filter((t) => !Number.isNaN(t));
  return Math.min(limite, ...fins);
}

export type Cache = {
  ler(chave: string, agora: number): Promise<Oferta[] | undefined>;
  gravar(chave: string, ofertas: Oferta[], agora: number): Promise<void>;
};

/** Cache guardado num arquivo JSON. Um arquivo ausente ou corrompido vale como cache vazio. */
export function cacheEmArquivo(caminho: string): Cache {
  let entradas: Record<string, Entrada> | undefined;
  const carregar = async () => {
    if (entradas) return entradas;
    const texto = await readFile(caminho, "utf8").catch(() => "{}");
    const lido = Arquivo.safeParse(lerJson(texto));
    entradas = lido.success ? lido.data : {};
    return entradas;
  };
  return {
    async ler(c, agora) {
      const entrada = (await carregar())[c];
      return entrada && entrada.expiraEm > agora ? entrada.ofertas : undefined;
    },
    async gravar(c, ofertas, agora) {
      const todas = await carregar();
      todas[c] = { expiraEm: expiracao(ofertas, agora), ofertas };
      for (const [k, e] of Object.entries(todas)) if (e.expiraEm <= agora) Reflect.deleteProperty(todas, k);
      await mkdir(dirname(caminho), { recursive: true });
      await writeFile(caminho, JSON.stringify(todas, null, 2));
    },
  };
}

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
