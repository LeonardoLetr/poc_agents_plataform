# Servidor MCP de mercados

Servidor MCP que busca os preços das grandes redes de supermercado (Tauste, Carrefour, Assaí e Atacadão) e devolve ao
agente só uma lista curta de produto e preço, em vez do encarte inteiro. Não usa LLM: é só código.

Ele roda no seu computador. A página do Agent Lab, mesmo publicada no GitHub Pages, roda no seu navegador; por isso o
navegador conecta direto em `http://localhost:3333/mcp`, sem expor nada na internet.

## De onde vêm os preços

| Rede | Fonte | Observação |
|---|---|---|
| Tauste | API GraphQL da loja online, por unidade física | escolhe a loja da cidade com CEP mais próximo; preço normal e promocional |
| Carrefour | cartões da página de busca da loja online | a API da loja recusa chamadas automáticas; preço da loja online, região padrão |
| Atacadão | busca pública de catálogo da loja online (VTEX) | itens a quilo já vêm com o preço por kg; preço da loja online |
| Assaí | encartes por loja publicados no site | as páginas são imagens: os preços só aparecem com `ANTHROPIC_API_KEY` (veja abaixo) |

Os sites mudam sem aviso. Quando uma rede falhar, a resposta traz um aviso para ela e as demais seguem normalmente.

## Como rodar

Requer Node.js 22.18 ou mais novo.

```bash
git clone https://github.com/LeonardoLetr/poc_agents_plataform.git
cd poc_agents_plataform
npm install
npm run mercados
```

No Agent Lab, em **Servidores MCP**, o servidor **mercados** (`http://localhost:3333/mcp`) já vem cadastrado e desligado:
com o servidor rodando, clique em **Conectar**. Se o Chrome perguntar se o site pode acessar a rede local, permita. O
agente **Comparador de Mercados** usa a ferramenta `buscar_precos` deste servidor, no Claude Haiku.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `buscar_precos` | Recebe o CEP, a cidade, os produtos e, opcionalmente, as redes. Devolve, por produto, as 5 ofertas mais baratas, com preço por kg quando dá para calcular, validade e fonte, e um aviso para cada rede que falhou. |
| `listar_redes` | Lista as redes atendidas. |

## Cache

Encartes valem a semana: a primeira consulta de cada produto busca na rede e as seguintes saem do cache até o fim da
oferta (no máximo 7 dias). Lojas com CEP de mesmo prefixo (5 dígitos) compartilham o cache. O arquivo fica em
`~/.agent-lab/mercados-cache.json`.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3333` | Porta do servidor. |
| `ORIGENS` | (vazio) | Sites extras autorizados a chamar o servidor, separados por vírgula. O site publicado e o ambiente local do Agent Lab já são autorizados. |
| `CACHE` | `~/.agent-lab/mercados-cache.json` | Caminho do arquivo de cache. |
| `ANTHROPIC_API_KEY` | (vazio) | Opcional. Lê os encartes do Assaí, que só existem em imagem, com o Haiku: uma leitura por encarte, guardada no cache até o fim da validade. A chave fica só no servidor local e vai apenas à API da Anthropic. |
| `MODELO_ENCARTE` | `claude-haiku-5-5` | Modelo usado na leitura dos encartes. |

## Limites

- Só funciona no computador em que o servidor está rodando (no celular, `localhost` é o próprio celular).
- Não serve para a opção "API da Anthropic", porque os servidores da Anthropic não enxergam o seu `localhost`.
