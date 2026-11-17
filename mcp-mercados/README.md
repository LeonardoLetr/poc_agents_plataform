# Servidor MCP de mercados

Servidor MCP que busca os preços das grandes redes de supermercado (Tauste, Carrefour, Assaí e Atacadão) e devolve ao
agente só uma lista curta de produto e preço, em vez do encarte inteiro. Não usa LLM: é só código.

Ele roda no seu computador. A página do Agent Lab, mesmo publicada no GitHub Pages, roda no seu navegador; por isso o
navegador conecta direto em `http://localhost:3333/mcp`, sem expor nada na internet.

> **Estado atual:** o servidor, as ferramentas e o cache estão prontos; as fontes de preço de cada rede ainda não. Até
> elas serem implementadas, `buscar_precos` devolve um aviso por rede.

## Como rodar

Requer Node.js 22.18 ou mais novo.

```bash
git clone https://github.com/LeonardoLetr/poc_agents_plataform.git
cd poc_agents_plataform
npm install
npm run mercados
```

No Agent Lab, em **Servidores MCP**, cadastre um **Servidor remoto (HTTP)** com o endereço `http://localhost:3333/mcp`
e, em **Quem faz a conexão**, escolha **Agent Lab**. Se o Chrome perguntar se o site pode acessar a rede local, permita.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `buscar_precos` | Recebe o CEP, os produtos e, opcionalmente, as redes. Devolve, por produto, as ofertas da mais barata para a mais cara, com preço por kg quando dá para calcular, validade e fonte, e um aviso para cada rede que falhou. |
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

## Limites

- Só funciona no computador em que o servidor está rodando (no celular, `localhost` é o próprio celular).
- Não serve para a opção "API da Anthropic", porque os servidores da Anthropic não enxergam o seu `localhost`.
