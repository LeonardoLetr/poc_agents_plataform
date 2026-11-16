import { describe, expect, it } from "vitest";
import { evaluate } from "../tools/calculator.js";

describe("calculadora (sem eval)", () => {
  it("respeita precedência, parênteses e unário", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("-3 + 5")).toBe(2);
    expect(evaluate("10 % 4")).toBe(2);
  });

  it("trata potência como associativa à direita", () => {
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("(1250 * 1.08) ^ 2")).toBe(1822500);
  });

  it("suporta funções e constantes", () => {
    expect(evaluate("sqrt(16) + abs(-2)")).toBe(6);
    expect(evaluate("max(1, 7, 3)")).toBe(7);
    expect(evaluate("round(pi * 100)")).toBe(314);
  });

  it("arredonda ruído de ponto flutuante", () => {
    expect(evaluate("0.1 + 0.2")).toBe(0.3);
  });

  it("rejeita entradas inválidas com mensagens claras", () => {
    expect(() => evaluate("1 / 0")).toThrow(/Divisão por zero/);
    expect(() => evaluate("foo(2)")).toThrow(/Função desconhecida/);
    expect(() => evaluate("(1 + 2")).toThrow(/Parêntese não fechado/);
    expect(() => evaluate("2 +")).toThrow(/Símbolo inesperado/);
  });

  it("não executa código arbitrário", () => {
    expect(() => evaluate("process.exit(1)")).toThrow();
    expect(() => evaluate("constructor.constructor('return 1')()")).toThrow();
  });
});
