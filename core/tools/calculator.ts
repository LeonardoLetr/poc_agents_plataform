/**
 * Avaliador de expressões por descida recursiva — sem `eval`, portanto seguro
 * para receber entrada gerada por um LLM.
 */
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  log: Math.log10,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluate(src: string): number {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => {
    if (s[i] === c) {
      i++;
      return true;
    }
    return false;
  };

  function expr(): number {
    let v = term();
    for (;;) {
      if (eat("+")) v += term();
      else if (eat("-")) v -= term();
      else return v;
    }
  }
  function term(): number {
    let v = power();
    for (;;) {
      if (eat("*")) v *= power();
      else if (eat("/")) {
        const d = power();
        if (d === 0) throw new Error("Divisão por zero.");
        v /= d;
      } else if (eat("%")) v %= power();
      else return v;
    }
  }
  function power(): number {
    const b = unary();
    if (eat("^")) return Math.pow(b, power());
    return b;
  }
  function unary(): number {
    if (eat("-")) return -unary();
    if (eat("+")) return unary();
    return atom();
  }
  function atom(): number {
    if (eat("(")) {
      const v = expr();
      if (!eat(")")) throw new Error("Parêntese não fechado.");
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) {
      const name = id[0].toLowerCase();
      i += id[0].length;
      const constant = CONSTS[name];
      if (constant !== undefined) return constant;
      const fn = FUNCS[name];
      if (!fn) throw new Error(`Função desconhecida: ${name}`);
      if (!eat("(")) throw new Error(`Esperado "(" após ${name}`);
      const args = [expr()];
      while (eat(",") || eat(";")) args.push(expr());
      if (!eat(")")) throw new Error("Parêntese não fechado.");
      return fn(...args);
    }
    throw new Error(`Símbolo inesperado na posição ${i + 1}: "${peek() ?? "fim"}"`);
  }

  const v = expr();
  if (i < s.length) throw new Error(`Símbolo inesperado na posição ${i + 1}: "${s[i]}"`);
  if (!Number.isFinite(v)) throw new Error("Resultado não é um número finito.");
  return Math.round(v * 1e12) / 1e12;
}
