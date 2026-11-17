# Agent Lab

Plataforma visual para estudo de agentes autônomos. Permite configurar agentes com diferentes modelos de linguagem,
conectar ferramentas via **MCP**, gerenciar **prompts** e **memória** e acompanhar cada decisão do agente em tempo real,
com trilha de **auditoria** completa.

São suportados três tipos de provedor: Claude (SDK oficial da Anthropic), qualquer API compatível com o formato
OpenAI Chat Completions (OpenAI, OpenRouter, Groq, Ollama) e um modelo simulado para uso sem chave de API.

![Playground com execução em andamento](docs/screenshots/playground.jpg)

## Funcionalidades

| Tela | Descrição |
|---|---|
| **Playground** | Execução de tarefas com visualização do loop agêntico em tempo real: grafo de interação (modelo, ferramentas e memória), linha do tempo com raciocínio, chamadas `tool_use`/`tool_result` e consumo de tokens por iteração. Inclui inspeção da janela de contexto, continuação da conversa, aprovação manual de ferramentas (*human-in-the-loop*) e replay passo a passo de execuções concluídas. |
| **Janela de contexto** | Medidor por iteração (tokens de entrada, percentual da janela do modelo, cache e composição do contexto) e resumo automático do histórico ao passar de um limite configurável por agente, registrado na linha do tempo e na auditoria. |
| **Multiagente** | Agentes podem delegar subtarefas a outros agentes, usados como ferramentas. Cada delegação é uma execução filha acompanhada ao vivo dentro da execução pai, com tokens agregados, limite de profundidade e bloqueio de delegação circular. |
| **Comparar** | Execução da mesma tarefa em paralelo em até quatro combinações de agente e LLM, com progresso ao vivo e tabela de tokens, custo, duração, iterações e ferramentas, exportável em JSON. |
| **Agentes** | Configuração de agentes: LLM, prompt de sistema, ferramentas nativas, MCP e de servidor da Anthropic (busca e leitura de páginas web), política de memória, limite de iterações e aprovação humana. |
| **LLMs** | Cadastro de modelos em tempo de execução (provedor, modelo, chave, URL base e nível de esforço). Cada agente referencia uma LLM, que pode ser trocada a qualquer momento. |
| **Servidores MCP** | Conexão de servidores via HTTP (pelo Agent Lab ou pela API da Anthropic, sem depender de CORS) ou execução embutida, edição da configuração, listagem das ferramentas descobertas, teste manual de `tools/call`, logs e diagnóstico de erros de conexão. |
| **Memória** | Quatro camadas (curto prazo, trabalho, longo prazo e episódica), visualização das memórias e simulação de recuperação com pontuação detalhada. |
| **Prompts** | Biblioteca de prompts de sistema e de tarefa. Prompts de tarefa viram atalhos no Playground, nos agentes escolhidos, com variáveis `{{nome}}` preenchidas antes de usar. |
| **Auditoria** | Registro de todas as ações (autor, horário, tokens e duração), com filtros, atualização em tempo real e exportação em JSON. |
| **Exportar e importar** | Rodapé da barra lateral: salva a configuração (agentes, LLMs sem chaves, prompts, servidores MCP e memórias) em JSON e importa de volta, mesclando ou substituindo, com relatório de conflitos. |
| **Aprender** | Material de apoio sobre o loop agêntico, o protocolo de ferramentas e os principais conceitos, com exercícios práticos. |

<p>
  <img src="docs/screenshots/visao-geral.jpg" width="49%" alt="Visão geral" />
  <img src="docs/screenshots/memoria.jpg" width="49%" alt="Memória" />
  <img src="docs/screenshots/mcp.jpg" width="49%" alt="Servidores MCP" />
  <img src="docs/screenshots/auditoria.jpg" width="49%" alt="Auditoria" />
</p>

<p><img src="docs/screenshots/playground-escuro.jpg" alt="Playground no tema escuro" /></p>

## Versão online

A interface é publicada no GitHub Pages pelo workflow [`deploy-pages.yml`](.github/workflows/deploy-pages.yml):
**https://leonardoletr.github.io/poc_agents_plataform/**

A aplicação não tem servidor próprio: o núcleo é executado na própria página, os dados ficam no armazenamento local
do navegador e as chaves de API são informadas por cada usuário na tela **LLMs**.

Limitações por rodar no navegador:
- servidores MCP remotos conectados pelo Agent Lab precisam permitir requisições vindas da página (CORS). Com LLMs
  Anthropic, escolha "API da Anthropic" no cadastro do servidor: a conexão passa a ser feita pela API do Claude;
- a ferramenta `http_fetch` só acessa sites que permitem requisições de outras origens (CORS). Com LLMs Anthropic, use
  `web_search` e `web_fetch`, executadas na infraestrutura da Anthropic e sem essa restrição;
- servidores MCP locais (transporte `stdio`) não são suportados.

## Execução local

Requisito: **Node.js 20+**.

```bash
npm install
npm run dev               # interface em http://localhost:5173
```

Localmente a aplicação funciona como a versão online: núcleo na página e dados no navegador.

- O agente **Demo (offline)** funciona sem chave de API. O modelo é simulado, mas ferramentas, memória, MCP e auditoria
  operam normalmente.
- Para usar um modelo real, informe a chave na tela **LLMs**.
- O servidor MCP de exemplo (`laboratorio`) é embutido e conecta automaticamente.
- O agente **Coordenador (offline)** demonstra o multiagente sem chave: delega a tarefa ao Agente Demo.
- O **Assistente de E-mail** usa Claude e o servidor MCP de e-mail habilitado no editor do agente (por exemplo, Gmail
  pelo Zapier, conectado como "Servidor remoto (HTTP)" pela API da Anthropic): mostra o rascunho e só envia depois da
  confirmação do usuário na conversa.
- O agente **Supervisor** usa Claude: divide a tarefa e delega ao Pesquisador (busca na web) e ao Analista de Dados
  (cálculos), consolidando as respostas. Requer a chave da LLM "Claude Opus 5.5".
- O **Comparador de Mercados** usa Claude: pede o CEP uma vez (e o guarda na memória), localiza as lojas das grandes
  redes da lista nas instruções e compara os preços dos encartes da semana, delegando a busca ao Pesquisador e as
  contas ao Analista de Dados. A lista de redes pode ser editada no editor do agente.
- O **Agente Demo** usa uma janela simulada de 4 mil tokens: ao continuar a conversa algumas vezes, o resumo automático
  do histórico aparece no medidor e na linha do tempo.

Build de produção: `npm run build` (arquivos estáticos em `web/dist`) e `npm run preview` para servi-lo localmente.

## Arquitetura

Toda a lógica está em [`core/`](core/), um núcleo **sem dependências de Node.js**, executado na própria página. A
interface conversa com ele por chamada de função, com as mesmas rotas de uma API (`core/router.ts`), e a persistência
fica no `localStorage`, por meio de um adaptador de armazenamento. Essa separação permite hospedar o núcleo em um
servidor no futuro sem reescrevê-lo (item AL-14 do backlog).

```mermaid
flowchart LR
  UI["Interface React<br/>(grafo, linha do tempo, páginas)"] -- "chamada direta" --> Router["core/router.ts"]
  Router --> Loop["Loop agêntico<br/>core/agent/runner.ts"]
  Loop -- "messages + tools" --> LLM["LLM configurada<br/>Claude · compatível com OpenAI · demo"]
  LLM -- "thinking / text / tool_use" --> Loop
  LLM -. "web_search / web_fetch<br/>(executadas pela Anthropic)" .-> Web["Web"]
  Loop --> Nativas["Ferramentas nativas<br/>calculadora, HTTP, data e hora,<br/>memória, scratchpad"]
  Loop --> MCP["Cliente MCP"] --> Servers["Servidores MCP<br/>(HTTP / embutido)"]
  Loop -- "agent__&lt;id&gt;" --> Filha["Execução filha<br/>(outro agente, mesmo loop)"]
  Loop --> Mem[("Memória")]
  Loop --> Audit[("Auditoria")]
```

O loop agêntico ([`core/agent/runner.ts`](core/agent/runner.ts)) executa, a cada iteração:

1. montagem do **contexto**: prompt de sistema, memórias recuperadas e histórico de mensagens;
2. chamada à **LLM do agente** com a lista de ferramentas. No Claude, com streaming, pensamento adaptativo com resumo e
   cache de prefixo; em provedores compatíveis com OpenAI, o histórico é convertido (`tool_use` ↔ `tool_calls`);
3. **execução das ferramentas** solicitadas (em paralelo, com aprovação opcional) e retorno de todos os `tool_result`
   em uma única mensagem;
4. medição da janela de contexto e, se o agente habilitou e o limite foi atingido, substituição do histórico por um
   resumo gerado pelo próprio modelo antes da próxima chamada;
5. repetição até `stop_reason: end_turn` ou até o limite de iterações. Ao final, um resumo pode ser salvo como memória
   episódica.

Cada etapa gera um evento para a visualização e um registro de auditoria.

### Estrutura

```
core/                  núcleo da plataforma (executado na página)
  agent/runner.ts      loop agêntico: início, iterações e término das execuções
  agent/turn.ts        decisões sobre cada turno do modelo (funções puras)
  agent/tools.ts       ferramentas da execução: seleção, aprovação e execução
  agent/live.ts        execuções em andamento e emissão de eventos
  agent/delegation.ts  multiagente: agentes como ferramentas
  agent/context.ts     medição da janela de contexto e regras do resumo
  agent/compaction.ts  resumo automático do histórico durante a execução
  llm/                 provedores: anthropic.ts, openai.ts, demo.ts
  mcp/manager.ts       cliente MCP (Streamable HTTP, SSE e em memória)
  mcp/remote.ts        servidores MCP conectados pela API do Claude (conector MCP)
  mcp/lab-server.ts    servidor MCP de exemplo
  tools/builtin.ts     ferramentas nativas
  tools/server.ts      ferramentas de servidor da Anthropic (web_search, web_fetch)
  memory.ts            memória de longo prazo e ranking de recuperação
  router.ts            API: despacho das rotas e streams
  routes/              rotas por recurso (agents.ts, llms.ts, mcp.ts, runs.ts…)
  seed.ts              dados iniciais e migração de versões
web/src/
  lib/runtime.ts       inicialização do núcleo e armazenamento local (dados e cofre de chaves)
  pages/               telas
  components/          grafo do agente, linha do tempo e componentes de interface
web/scripts/           verificações automatizadas (layout em dispositivos móveis)
docs/                  referências de design e estudos de layout
.github/workflows/     CI e publicação no GitHub Pages
```

### Servidores MCP

Em **Servidores MCP → Adicionar servidor** há configuração manual para servidores remotos (HTTP), conectados pelo
Agent Lab ou pela API da Anthropic, e servidores embutidos. As ferramentas são expostas como
`mcp__<servidor>__<ferramenta>` e podem ser habilitadas por agente, todas de uma vez (`mcp__<servidor>__*`) ou
individualmente. O servidor embutido de exemplo, em `core/mcp/lab-server.ts`, serve de modelo para novos servidores.

Nos servidores conectados pela API da Anthropic, a lista de ferramentas não passa pela página. O botão **Descobrir
ferramentas** faz uma chamada curta ao Claude com o servidor anexado e registra os nomes e descrições devolvidos;
além disso, cada ferramenta que um agente usar fica registrada no servidor. Ferramentas conhecidas podem ser
habilitadas individualmente no editor do agente.

## Segurança

- `http_fetch` bloqueia endereços locais e privados; a calculadora não utiliza `eval`.
- `web_search` e `web_fetch` têm limite de 5 usos por chamada ao modelo. A busca é cobrada à parte pela Anthropic, por
  requisição; o conteúdo lido entra nos tokens de entrada.
- O Markdown renderizado aceita apenas links `http(s)`.
- Cada agente tem limite de iterações e pode exigir aprovação para cada ferramenta.
- Memórias salvas por um agente são privadas dele. Um agente só remove as próprias; memórias globais, criadas pelo
  usuário, e as de outros agentes ficam protegidas.
- As rotas internas nunca retornam chaves de API, apenas os quatro últimos caracteres; valores de cabeçalhos dos
  servidores MCP aparecem ocultos.
- As chaves não são enviadas ao GitHub nem a servidores intermediários. As requisições vão diretamente do navegador ao
  provedor, via HTTPS (ou, no conector MCP, do navegador à API da Anthropic).
- As chaves são armazenadas separadamente dos demais dados, por padrão no `sessionStorage`, que é descartado ao fechar
  o navegador. A opção *Lembrar chaves neste navegador* utiliza o `localStorage`.
- O build publicado define uma **Content-Security-Policy** que restringe a execução de scripts à própria origem.
- Recomenda-se uma **chave dedicada, com limite de gastos**, revogada após o uso. Extensões do navegador e outras páginas
  publicadas em `leonardoletr.github.io` (mesma origem) têm acesso ao armazenamento local.

## Qualidade

- O CI verifica os tipos, os testes e o build a cada push.
- `npm test` executa a suíte do núcleo com Vitest (`core/tests/`): calculadora, memória, provedor compatível com
  OpenAI, rotas da API, loop agêntico com a LLM demo, aprovação humana, MCP embutido, delegação entre agentes, medição e resumo da janela de contexto, ferramentas de servidor da
  Anthropic (com respostas simuladas) e migração de dados. A suíte
  roda no CI e antes de cada publicação.
- `web/scripts/check-mobile.cjs` valida que nenhuma página excede a largura da tela em três dispositivos móveis. A
  verificação é pré-requisito para a publicação.

## Design

A interface tem tema claro (tom papel) e escuro (grafite), alternáveis pelo botão na barra superior; sem escolha
salva, segue a preferência do sistema. A especificação completa, reutilizável em outros projetos, está em
[`docs/style-guides/painel-saas-claro.md`](docs/style-guides/painel-saas-claro.md), e o mapeamento para o código em
[`.claude/skills/agent-lab-ui`](.claude/skills/agent-lab-ui/SKILL.md). As referências consultadas estão em
[`docs/pesquisa-visual.md`](docs/pesquisa-visual.md) e os estudos de layout em [`docs/design-concepts`](docs/design-concepts/README.md).

**Stack:** Node.js, Express, TypeScript, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` · React 19, Vite,
Tailwind CSS 4, Motion, React Flow.
