import { normalizar } from "../comparacao.ts";
import type { Oferta, Resultado } from "../tipos.ts";

/** Peças comuns das fontes: requisição com erro tratado e leitura de peso e preço como os sites escrevem. */

const NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

/** Busca uma URL e devolve o corpo como texto, ou o motivo da falha (sem exceção para erros de rede ou HTTP). */
export async function baixar(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Resultado<string>> {
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", NAVEGADOR);
    const res = await fetch(url, { ...init, signal, headers });
    if (!res.ok) return { ok: false, erro: `o site respondeu ${res.status}` };
    return { ok: true, valor: await res.text() };
  } catch (err) {
    return {
      ok: false,
      erro: err instanceof Error && err.name === "TimeoutError" ? "o site demorou demais" : "não foi possível acessar o site",
    };
  }
}

export function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/** Peso da embalagem no nome do produto ("Banana Prata 600g", "Arroz 5kg"), em gramas. */
export function pesoEmGramas(nome: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i.exec(nome);
  if (!m?.[1] || !m[2]) return undefined;
  const valor = Number(m[1].replace(",", "."));
  return m[2].toLowerCase() === "kg" ? valor * 1000 : valor;
}

/** "R$ 10,39" → 10.39. */
export function lerPreco(texto: string): number | undefined {
  const m = /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(texto);
  return m?.[1] && m[2] ? Number(`${m[1].replace(/\./g, "")}.${m[2]}`) : undefined;
}

/** Unidade de venda a partir do nome: vendido a quilo, embalagem com peso conhecido ou unidade. */
export function unidadeDoNome(nome: string): Pick<Oferta, "unidade" | "quantidadeGramas"> {
  if (/\b(quilo|kg)\b/i.test(nome) && !/\d\s*kg\b/i.test(nome)) return { unidade: "kg" };
  const gramas = pesoEmGramas(nome);
  return gramas ? { unidade: "pacote", quantidadeGramas: gramas } : { unidade: "unidade" };
}

/** Entre lojas da cidade, a de CEP mais próximo: mais dígitos iniciais em comum e, no empate, menor diferença numérica. */
export function lojaMaisProxima<T extends { cep: string }>(lojas: readonly T[], cep: string): T | undefined {
  const alvo = cep.replace(/\D/g, "");
  const comum = (outro: string) => {
    let i = 0;
    while (i < alvo.length && alvo[i] === outro[i]) i++;
    return i;
  };
  return [...lojas].sort((a, b) => {
    const ca = a.cep.replace(/\D/g, "");
    const cb = b.cep.replace(/\D/g, "");
    return comum(cb) - comum(ca) || Math.abs(Number(ca) - Number(alvo)) - Math.abs(Number(cb) - Number(alvo));
  })[0];
}

export const mesmaCidade = (a: string, b: string) => normalizar(a) === normalizar(b);
