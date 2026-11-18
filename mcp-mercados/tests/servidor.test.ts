import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { Cache } from "../src/cache.ts";
import { iniciar } from "../src/servidor.ts";
import type { Fonte, Oferta, Rede } from "../src/tipos.ts";

const memoria = (): Cache => {
  const dados = new Map<string, Oferta[]>();
  return { ler: async (k) => dados.get(k), gravar: async (k, o) => void dados.set(k, o) };
};

/** Fonte de teste: conta as buscas e devolve as ofertas fixas da rede. */
const fonte = (rede: Rede, ofertas: Omit<Oferta, "rede" | "fonte">[], chamadas: string[][]): Fonte => ({
  rede,
  buscar: async (produtos) => {
    chamadas.push([...produtos]);
    return { ok: true, valor: ofertas.map((o) => ({ ...o, rede, fonte: `encarte ${rede}` })) };
  },
});
const falha = (rede: Rede): Fonte => ({ rede, buscar: async () => ({ ok: false, erro: "encarte não encontrado" }) });

let servidor: Server | undefined;
afterEach(() => servidor?.close());

async function subir() {
  const chamadas: string[][] = [];
  servidor = await iniciar(
    {
      fontes: {
        tauste: fonte("tauste", [{ nome: "Banana Prata", preco: 5.49, unidade: "kg", promocao: true }], chamadas),
        carrefour: fonte("carrefour", [{ nome: "Banana Prata", preco: 4.99, unidade: "kg", promocao: true }], chamadas),
        assai: falha("assai"),
        atacadao: fonte("atacadao", [], chamadas),
      },
      cache: memoria(),
      agora: () => Date.parse("2026-11-17T10:00:00"),
    },
    { porta: 0 },
  );
  const { port } = servidor.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, chamadas };
}

describe("servidor MCP de mercados", () => {
  it("compara as redes, avisa as que falharam e usa o cache na segunda consulta", async () => {
    const { url, chamadas } = await subir();
    const client = new Client({ name: "teste", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["listar_redes", "buscar_precos"]);

    const consultar = async () => {
      const r = await client.callTool({
        name: "buscar_precos",
        arguments: { cep: "18010-000", cidade: "Sorocaba", produtos: ["banana prata"] },
      });
      const [bloco] = r.content as { type: string; text: string }[];
      return JSON.parse(bloco?.text ?? "{}");
    };
    const primeira = await consultar();
    expect(primeira.produtos[0].ofertas.map((o: Oferta) => o.rede)).toEqual(["carrefour", "tauste"]);
    expect(primeira.avisos).toEqual(["Assaí: encarte não encontrado"]);
    expect(chamadas).toHaveLength(3);

    await consultar();
    expect(chamadas).toHaveLength(3); // tudo veio do cache, inclusive o "não tem" do Atacadão
    await client.close();
  });

  it("libera o site do Agent Lab, inclusive a chamada a endereço local, e recusa outras origens", async () => {
    const { url } = await subir();
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://leonardoletr.github.io",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://leonardoletr.github.io");
    expect(preflight.headers.get("access-control-allow-private-network")).toBe("true");

    const outro = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://site-qualquer.dev" } });
    expect(outro.status).toBe(403);
  });
});
