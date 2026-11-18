import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encartesDaCidade, fonteAssai } from "../src/fontes/assai.ts";
import { ofertasAtacadao } from "../src/fontes/atacadao.ts";
import { ofertasCarrefour } from "../src/fontes/carrefour.ts";
import { lerPreco, lojaMaisProxima, pesoEmGramas, unidadeDoNome } from "../src/fontes/comum.ts";
import { lojasTauste, ofertasTauste } from "../src/fontes/tauste.ts";
import type { Oferta } from "../src/tipos.ts";

const fixture = (nome: string) => readFile(join(import.meta.dirname, "fixtures", nome), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("leitura de peso, preço e unidade", () => {
  it("entende como os sites escrevem", () => {
    expect(pesoEmGramas("Banana Prata Carrefour  600g")).toBe(600);
    expect(pesoEmGramas("Mamão Formosa Aprox. 1,6 Kg")).toBe(1600);
    expect(lerPreco("R$ 1.234,56")).toBe(1234.56);
    expect(unidadeDoNome("Banana Prata Quilo")).toEqual({ unidade: "kg" });
    expect(unidadeDoNome("Arroz Tipo 1 5kg")).toEqual({ unidade: "pacote", quantidadeGramas: 5000 });
    expect(unidadeDoNome("Abacaxi Pérola")).toEqual({ unidade: "unidade" });
  });
});

describe("Tauste", () => {
  // Trecho do JSON embutido na página inicial, com as aspas escapadas como no site.
  const html =
    "{\\u0022road_number\\u0022:\\u0022Av. Profa. Izoraida Marques Peres, 600\\u0022,\\u0022store_view_name\\u0022:\\u0022Tauste Campolim\\u0022,\\u0022city_zip_code\\u0022:\\u002218048110\\u0022,\\u0022name\\u0022:\\u0022Sorocaba 1 Store View\\u0022,\\u0022code\\u0022:\\u0022sorocaba1\\u0022,\\u0022city\\u0022:\\u0022Sorocaba\\u0022}" +
    "{\\u0022store_view_name\\u0022:\\u0022Tauste General\\u0022,\\u0022city_zip_code\\u0022:\\u002218043003\\u0022,\\u0022code\\u0022:\\u0022sorocaba3\\u0022,\\u0022city\\u0022:\\u0022Sorocaba\\u0022}" +
    "{\\u0022store_view_name\\u0022:\\u0022Tauste Mar\\\\u00edlia\\u0022,\\u0022city_zip_code\\u0022:\\u002217500000\\u0022,\\u0022code\\u0022:\\u0022marilia\\u0022,\\u0022city\\u0022:\\u0022Mar\\\\u00edlia\\u0022}";

  it("lê as lojas e escolhe a de CEP mais próximo na cidade", () => {
    const lojas = lojasTauste(html);
    expect(lojas.map((l) => l.codigo)).toEqual(["sorocaba1", "sorocaba3", "marilia"]);
    expect(lojas[2]?.cidade).toBe("Marília");
    const sorocaba = lojas.filter((l) => l.cidade === "Sorocaba");
    expect(lojaMaisProxima(sorocaba, "18048-500")?.nome).toBe("Tauste Campolim");
    expect(lojaMaisProxima(sorocaba, "18040-000")?.nome).toBe("Tauste General");
  });

  it("transforma a resposta GraphQL em ofertas, com promoção quando o preço final é menor", () => {
    const loja = { codigo: "sorocaba1", nome: "Tauste Campolim", cidade: "Sorocaba", cep: "18048110" };
    const item = (name: string, regular: number, final: number) => ({
      name,
      url_key: name.toLowerCase().replace(/\s+/g, "-"),
      price_range: { minimum_price: { regular_price: { value: regular }, final_price: { value: final } } },
    });
    const json = { data: { products: { items: [item("Banana Prata 1000g", 9.97, 9.97), item("Maçã Gala 800g", 12.5, 11)] } } };
    expect(ofertasTauste(json, loja)).toEqual([
      expect.objectContaining({ nome: "Banana Prata 1000g", preco: 9.97, unidade: "pacote", quantidadeGramas: 1000, promocao: false }),
      expect.objectContaining({
        nome: "Maçã Gala 800g",
        preco: 11,
        promocao: true,
        fonte: "https://tauste.com.br/sorocaba1/maçã-gala-800g.html",
      }),
    ]);
  });
});

describe("Carrefour", () => {
  it("lê os cartões da busca: preço com desconto, preço simples e link do produto", async () => {
    const ofertas = ofertasCarrefour(await fixture("carrefour-busca.html"));
    expect(ofertas.map((o) => [o.nome, o.preco, o.promocao])).toEqual([
      ["Banana Prata Fischer Turma da Mônica 750g", 8.29, true],
      ["Banana Prata Carrefour 600g", 6.54, false],
      ["Banana Prata Orgânico Carrefour Bio 600g", 10.99, false],
    ]);
    expect(ofertas[1]).toMatchObject({
      unidade: "pacote",
      quantidadeGramas: 600,
      fonte: "https://mercado.carrefour.com.br/produto/banana-prata-carrefour-600g-4733133",
    });
  });
});

describe("Atacadão", () => {
  it("usa o preço por kg dos itens a quilo e ignora os indisponíveis", async () => {
    const ofertas = ofertasAtacadao(JSON.parse(await fixture("atacadao-busca.json")));
    expect(ofertas).toEqual([expect.objectContaining({ nome: "Banana Prata Quilo", preco: 9.9, unidade: "kg", promocao: false })]);
  });
});

describe("Assaí", () => {
  const arquivo = {
    ofertas: [
      { id: "1", start_date: "16/11/2026", end_date: "22/11/2026", lojas: [{ nid: 23087 }], images: [{ url: "https://img/1.jpeg" }] },
      // Entradas antigas trazem "nid" no lugar de "id".
      { nid: "2", start_date: "17/11/2026", end_date: "18/11/2026", lojas: [{ nid: 141 }], images: [{ url: "https://img/2.jpeg" }] },
      { id: "3", start_date: "01/11/2026", end_date: "10/11/2026", lojas: [{ nid: 23087 }], images: [{ url: "https://img/3.jpeg" }] },
      { id: "4", start_date: "16/11/2026", end_date: "22/11/2026", lojas: [{ nid: 999 }], images: [{ url: "https://img/4.jpeg" }] },
      { quebrado: true },
    ],
    lojas: [
      { name: "Assaí Sorocaba Campolim", nid: 23087 },
      { name: "Assaí Sorocaba (Itavuvu)", nid: 141 },
      { name: "Assaí Campinas", nid: 999 },
    ],
  };

  it("encontra os encartes vigentes das lojas da cidade, sem deixar uma entrada quebrada derrubar as outras", () => {
    const encartes = encartesDaCidade(arquivo, "sorocaba", "2026-11-18");
    expect(encartes.map((e) => [e.id, e.fim, e.lojas])).toEqual([
      ["1", "2026-11-22", ["Assaí Sorocaba Campolim"]],
      ["2", "2026-11-18", ["Assaí Sorocaba (Itavuvu)"]],
    ]);
  });

  it("sem chave, avisa onde está o encarte; com chave, lê as imagens uma vez e guarda no cache", async () => {
    const agora = () => Date.parse("2026-11-18T12:00:00");
    const memoria = new Map<string, Oferta[]>();
    const cache = { ler: async (k: string) => memoria.get(k), gravar: async (k: string, o: Oferta[]) => void memoria.set(k, o) };
    const chamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        chamadas.push(url);
        // A primeira resposta imita a página de desafio da proteção contra robôs; a segunda traz o JSON.
        if (url.includes("ofertas_assai.json"))
          return new Response(
            chamadas.filter((u) => u.includes("ofertas_assai")).length === 1
              ? "<html>Pardon Our Interruption</html>"
              : JSON.stringify(arquivo),
          );
        const lista = [{ nome: "Banana Prata kg", preco: 5.98, unidade: "kg" }];
        return new Response(JSON.stringify({ content: [{ type: "text", text: `Aqui está: ${JSON.stringify(lista)}` }] }));
      }),
    );
    const local = { cep: "18048-110", cidade: "Sorocaba" };

    const semChave = await fonteAssai({ cache, agora, chaveApi: undefined, modelo: "m" }).buscar(
      ["banana"],
      local,
      AbortSignal.timeout(1000),
    );
    expect(semChave.ok).toBe(false);
    expect(!semChave.ok && semChave.erro).toMatch(/2 encartes vigentes.*ANTHROPIC_API_KEY.*https:\/\/img\/1\.jpeg/);

    const assai = fonteAssai({ cache, agora, chaveApi: "sk-teste", modelo: "m" });
    const lido = await assai.buscar(["banana"], local, AbortSignal.timeout(1000));
    expect(lido.ok && lido.valor[0]).toMatchObject({
      rede: "assai",
      nome: "Banana Prata kg",
      preco: 5.98,
      validade: "2026-11-22",
      promocao: true,
    });
    const leituras = chamadas.filter((u) => u.includes("anthropic")).length;
    expect(leituras).toBe(2); // um por encarte

    await assai.buscar(["banana"], local, AbortSignal.timeout(1000));
    expect(chamadas.filter((u) => u.includes("anthropic")).length).toBe(leituras); // segunda vez, do cache
  });
});
