import { describe, expect, it } from "vitest";
import { comparar, corresponde, precoPorKg } from "../src/comparacao.ts";
import type { Oferta } from "../src/tipos.ts";

const oferta = (o: Partial<Oferta> & Pick<Oferta, "nome" | "preco" | "unidade">): Oferta => ({
  rede: "tauste",
  promocao: true,
  fonte: "https://exemplo.dev/encarte.pdf",
  ...o,
});

describe("comparação de ofertas", () => {
  it("casa o produto pedido ignorando acentos, plural e palavras de ligação", () => {
    expect(corresponde("banana prata", "Bananas Prata kg")).toBe(true);
    expect(corresponde("maçã", "MACA GALA")).toBe(true);
    expect(corresponde("feijão carioca", "Feijão Preto 1kg")).toBe(false);
  });

  it("calcula o preço por kg quando o peso é conhecido", () => {
    expect(precoPorKg({ preco: 5.99, unidade: "kg" })).toBe(5.99);
    expect(precoPorKg({ preco: 12.9, unidade: "pacote", quantidadeGramas: 500 })).toBe(25.8);
    expect(precoPorKg({ preco: 3.49, unidade: "unidade" })).toBeUndefined();
  });

  it("ordena da mais barata para a mais cara, com as comparáveis por kg primeiro", () => {
    const ofertas = [
      oferta({ rede: "assai", nome: "Banana Prata", preco: 6.49, unidade: "kg" }),
      oferta({ rede: "tauste", nome: "Banana Prata bandeja", preco: 3.99, unidade: "bandeja" }),
      oferta({ rede: "carrefour", nome: "Banana Prata", preco: 4.99, unidade: "kg" }),
      oferta({ rede: "atacadao", nome: "Laranja Pera", preco: 2.99, unidade: "kg" }),
    ];
    const [banana] = comparar(["banana prata"], ofertas);
    expect(banana?.ofertas.map((o) => o.rede)).toEqual(["carrefour", "assai", "tauste"]);
    expect(banana?.ofertas[0]?.precoPorKg).toBe(4.99);
  });

  it("devolve a lista vazia quando nenhuma rede tem o produto", () => {
    expect(comparar(["kiwi"], [oferta({ nome: "Banana", preco: 5, unidade: "kg" })])).toEqual([{ produto: "kiwi", ofertas: [] }]);
  });
});
