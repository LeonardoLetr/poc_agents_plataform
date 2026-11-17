import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheEmArquivo, chave, expiracao } from "../src/cache.ts";
import type { Oferta } from "../src/tipos.ts";

const DIA = 24 * 60 * 60 * 1000;
const agora = Date.parse("2026-11-17T10:00:00");
const banana: Oferta = { rede: "tauste", nome: "Banana Prata", preco: 4.99, unidade: "kg", promocao: true, fonte: "encarte" };

describe("cache semanal", () => {
  it("vale até o fim da oferta que vence primeiro, e no máximo uma semana", () => {
    expect(expiracao([{ validade: "2026-11-19" }, { validade: "2026-11-21" }], agora)).toBe(Date.parse("2026-11-19T23:59:59"));
    expect(expiracao([{}], agora)).toBe(agora + 7 * DIA);
    expect(expiracao([{ validade: "2027-01-31" }], agora)).toBe(agora + 7 * DIA);
  });

  it("agrupa CEPs da mesma região e normaliza o produto na chave", () => {
    expect(chave("assai", "18010-000", "Maçã")).toBe(chave("assai", "18010999", "maca"));
  });

  it("guarda em arquivo, devolve até expirar e trata arquivo corrompido como vazio", async () => {
    const caminho = join(await mkdtemp(join(tmpdir(), "mercados-")), "cache.json");
    const cache = cacheEmArquivo(caminho);
    await cache.gravar("k", [{ ...banana, validade: "2026-11-18" }], agora);
    expect(await cacheEmArquivo(caminho).ler("k", agora + DIA)).toHaveLength(1);
    expect(await cacheEmArquivo(caminho).ler("k", agora + 3 * DIA)).toBeUndefined();
    expect(JSON.parse(await readFile(caminho, "utf8"))).toHaveProperty("k");

    await writeFile(caminho, "{ não é json");
    expect(await cacheEmArquivo(caminho).ler("k", agora)).toBeUndefined();
  });
});
