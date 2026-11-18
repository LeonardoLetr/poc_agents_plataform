import { z } from "zod";
import type { Cache } from "../cache.ts";
import { normalizar } from "../comparacao.ts";
import type { Fonte, Oferta, Resultado } from "../tipos.ts";
import { baixar, lerJson } from "./comum.ts";

/**
 * Assaí: não vende online. O site publica os encartes de cada loja num JSON, mas cada página é uma imagem. Com uma
 * chave da API da Anthropic, o Haiku lê as páginas uma vez por encarte e as ofertas ficam no cache até o fim dele;
 * sem chave, a fonte avisa onde está o encarte.
 */

const ENCARTES = "https://www.assai.com.br/sites/default/files/static/ofertas_assai.json";

// Cada encarte é lido sozinho: uma entrada fora do formato não derruba as outras.
const Arquivo = z.object({ ofertas: z.array(z.unknown()), lojas: z.array(z.unknown()) });
const EncarteSalvo = z.object({
  // Entradas antigas usam "nid" no lugar de "id".
  id: z.string().optional(),
  nid: z.string().optional(),
  start_date: z.string(),
  end_date: z.string(),
  lojas: z.array(z.object({ nid: z.number() })),
  images: z.array(z.object({ url: z.string() })),
});
const Loja = z.object({ name: z.string(), nid: z.number() });

export type Encarte = { id: string; inicio: string; fim: string; paginas: string[]; lojas: string[] };

/** "16/11/2026" → "2026-11-16". */
const isoDe = (data: string) => data.split("/").reverse().join("-");

/** Encartes vigentes hoje nas lojas da cidade (lojas com o nome da cidade, ex.: "Assaí Sorocaba Campolim"). */
export function encartesDaCidade(json: unknown, cidade: string, hoje: string): Encarte[] {
  const lido = Arquivo.safeParse(json);
  if (!lido.success) return [];
  const alvo = normalizar(cidade);
  const lojas = new Map(
    lido.data.lojas.flatMap((l) => {
      const loja = Loja.safeParse(l).data;
      return loja && loja.nid > 0 && normalizar(loja.name).includes(alvo) ? [[loja.nid, loja.name] as const] : [];
    }),
  );
  return lido.data.ofertas.flatMap((item) => {
    const o = EncarteSalvo.safeParse(item).data;
    const id = o?.id ?? o?.nid;
    if (!o || !id) return [];
    const daCidade = o.lojas.flatMap((l) => lojas.get(l.nid) ?? []);
    const inicio = isoDe(o.start_date);
    const fim = isoDe(o.end_date);
    if (!daCidade.length || inicio > hoje || fim < hoje) return [];
    return [{ id, inicio, fim, paginas: o.images.map((i) => i.url), lojas: [...new Set(daCidade)] }];
  });
}

const Extraidas = z.array(
  z.object({
    nome: z.string(),
    preco: z.number(),
    unidade: z.enum(["kg", "unidade", "bandeja", "pacote"]),
    quantidade_gramas: z.number().optional(),
    condicao: z.string().optional(),
  }),
);

const INSTRUCAO =
  "Estas imagens são as páginas de um encarte de ofertas de supermercado. Liste todos os produtos com preço, em JSON, " +
  'no formato [{"nome": "...", "preco": 9.99, "unidade": "kg" | "unidade" | "bandeja" | "pacote", ' +
  '"quantidade_gramas": 500, "condicao": "..."}]. Use "condicao" só quando o preço exigir algo (cartão, clube, ' +
  "quantidade mínima) e quantidade_gramas só quando o peso da embalagem estiver escrito. Responda apenas com o JSON.";

/** Lê as páginas do encarte com o Haiku. A chave fica só no servidor local e vai apenas à API da Anthropic. */
async function extrair(encarte: Encarte, chave: string, modelo: string, signal: AbortSignal): Promise<Resultado<Oferta[]>> {
  const r = await baixar("https://api.anthropic.com/v1/messages", signal, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [...encarte.paginas.map((url) => ({ type: "image", source: { type: "url", url } })), { type: "text", text: INSTRUCAO }],
        },
      ],
    }),
  });
  if (!r.ok) return { ok: false, erro: `leitura do encarte falhou (${r.erro})` };
  const texto = z
    .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
    .safeParse(lerJson(r.valor))
    .data?.content.flatMap((b) => (b.text ? [b.text] : []))
    .join("");
  const lista = Extraidas.safeParse(lerJson(texto?.slice(texto.indexOf("["), texto.lastIndexOf("]") + 1) ?? ""));
  if (!lista.success) return { ok: false, erro: "a leitura do encarte não voltou no formato esperado" };
  return {
    ok: true,
    valor: lista.data.map((o) => ({
      rede: "assai",
      nome: o.nome,
      preco: o.preco,
      unidade: o.unidade,
      ...(o.quantidade_gramas ? { quantidadeGramas: o.quantidade_gramas } : {}),
      ...(o.condicao ? { condicao: o.condicao } : {}),
      promocao: true,
      validade: encarte.fim,
      loja: encarte.lojas.join(", "),
      fonte: encarte.paginas[0] ?? ENCARTES,
    })),
  };
}

/**
 * Lista de encartes. Como o próprio site, acrescenta um parâmetro novo a cada pedido: sem ele, o CDN às vezes entrega
 * uma versão antiga do arquivo. A proteção contra robôs do site às vezes responde uma página de desafio no lugar do
 * JSON; nesse caso tenta mais uma vez.
 */
async function baixarEncartes(agora: () => number, signal: AbortSignal): Promise<Resultado<unknown>> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const r = await baixar(`${ENCARTES}?${agora()}-${tentativa}`, signal);
    if (!r.ok) return { ok: false, erro: `encartes indisponíveis (${r.erro})` };
    const json = lerJson(r.valor);
    if (json !== undefined) return { ok: true, valor: json };
  }
  return { ok: false, erro: "o site do Assaí bloqueou a consulta automática; tente de novo em alguns minutos" };
}

export function fonteAssai(deps: { cache: Cache; agora: () => number; chaveApi: string | undefined; modelo: string }): Fonte {
  return {
    rede: "assai",
    async buscar(_produtos, local, signal) {
      const arquivo = await baixarEncartes(deps.agora, signal);
      if (!arquivo.ok) return arquivo;
      const hoje = new Date(deps.agora()).toISOString().slice(0, 10);
      const encartes = encartesDaCidade(arquivo.valor, local.cidade, hoje);
      if (!encartes.length) return { ok: false, erro: `nenhum encarte vigente em ${local.cidade}` };
      if (!deps.chaveApi) {
        const paginas = encartes.reduce((n, e) => n + e.paginas.length, 0);
        return {
          ok: false,
          erro:
            `${encartes.length} encartes vigentes (${paginas} páginas, só em imagem, até ${encartes.map((e) => e.fim).sort()[0] ?? ""}). ` +
            `Para ler os preços, inicie o servidor com ANTHROPIC_API_KEY. Primeira página: ${encartes[0]?.paginas[0] ?? ""}`,
        };
      }
      const ofertas: Oferta[] = [];
      for (const encarte of encartes) {
        const chave = `encarte|assai|${encarte.id}`;
        const salvas = await deps.cache.ler(chave, deps.agora());
        if (salvas) {
          ofertas.push(...salvas);
          continue;
        }
        const lidas = await extrair(encarte, deps.chaveApi, deps.modelo, signal);
        if (!lidas.ok) return lidas;
        await deps.cache.gravar(chave, lidas.valor, deps.agora());
        ofertas.push(...lidas.valor);
      }
      return { ok: true, valor: ofertas };
    },
  };
}
