import type { Oferta } from "./tipos.ts";

/** Regras puras da comparação: casar o produto pedido com as ofertas e ordenar pelo preço comparável. */

const IGNORADAS = new Set(["de", "da", "do", "das", "dos", "com", "sem", "em", "a", "o", "e"]);

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavras relevantes, sem o plural simples ("bananas" → "banana"), para "banana" casar com "Bananas Prata". */
function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((p) => p.length > 1 && !IGNORADAS.has(p))
    .map((p) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p));
}

/** A oferta corresponde ao produto pedido quando contém todas as palavras dele. */
export function corresponde(produto: string, nomeOferta: string): boolean {
  const pedidas = palavras(produto);
  const daOferta = new Set(palavras(nomeOferta));
  return pedidas.length > 0 && pedidas.every((p) => daOferta.has(p));
}

/** Preço por kg quando dá para calcular: vendido por kg ou em pacote com o peso informado. */
export function precoPorKg(oferta: Pick<Oferta, "preco" | "unidade" | "quantidadeGramas">): number | undefined {
  if (oferta.unidade === "kg") return oferta.preco;
  if (oferta.unidade === "pacote" && oferta.quantidadeGramas)
    return Math.round((oferta.preco / oferta.quantidadeGramas) * 1000 * 100) / 100;
  return undefined;
}

export type Comparacao = {
  produto: string;
  /** Da mais barata para a mais cara: primeiro as comparáveis por kg, depois as demais pelo preço. */
  ofertas: (Oferta & { precoPorKg?: number })[];
};

export function comparar(produtos: readonly string[], ofertas: readonly Oferta[]): Comparacao[] {
  return produtos.map((produto) => {
    const encontradas = ofertas
      .filter((o) => corresponde(produto, o.nome))
      .map((o): Oferta & { precoPorKg?: number } => {
        const porKg = precoPorKg(o);
        return porKg === undefined ? { ...o } : { ...o, precoPorKg: porKg };
      })
      .sort((a, b) => {
        if (a.precoPorKg !== undefined && b.precoPorKg !== undefined) return a.precoPorKg - b.precoPorKg;
        if (a.precoPorKg !== undefined) return -1;
        if (b.precoPorKg !== undefined) return 1;
        return a.preco - b.preco;
      });
    return { produto, ofertas: encontradas };
  });
}
