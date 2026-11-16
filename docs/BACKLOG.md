# Backlog do Agent Lab

Melhorias e novas funcionalidades planejadas, priorizadas por impacto e esforço.

**Prioridade:** P0 (risco ou defeito ativo) · P1 (alto valor) · P2 (melhoria) · P3 (opcional)
**Esforço:** P (até meio dia) · M (1 a 3 dias) · G (mais de 3 dias)
**Status:** a fazer · em andamento · concluído

## Resumo

| ID | Item | Tipo | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| AL-01 | Testes automatizados do núcleo | Qualidade | P0 | M | concluído |
| AL-02 | Ranking de memória mais robusto | Correção | P1 | P | concluído |
| AL-03 | Episódios de memória sem acúmulo de conteúdo | Correção | P1 | P | concluído |
| AL-04 | Comparação de LLMs e agentes lado a lado | Funcionalidade | P1 | M | concluído |
| AL-05 | Multiagente: agente como ferramenta e supervisor | Funcionalidade | P1 | G | concluído |
| AL-06 | Ferramentas de servidor do Claude (web search e web fetch) | Funcionalidade | P1 | P | concluído |
| AL-07 | Gestão da janela de contexto (medidor e resumo) | Funcionalidade | P1 | M | concluído |
| AL-08 | Replay passo a passo de execuções | Funcionalidade | P2 | M | concluído |
| AL-09 | Exportar e importar configuração | Funcionalidade | P2 | P | a fazer |
| AL-10 | Prompts de tarefa com variáveis no Playground | Funcionalidade | P2 | P | a fazer |
| AL-11 | Aprovação humana por ferramenta | Melhoria | P2 | P | a fazer |
| AL-12 | Preços de modelos compatíveis com OpenAI | Melhoria | P3 | P | a fazer |
| AL-13 | Busca semântica de memória com embeddings | Funcionalidade | P3 | M | a fazer |
| AL-14 | Publicação do servidor na AWS | Infraestrutura | P3 | G | a fazer |
| AL-15 | Servidores MCP remotos via conector da API do Claude | Funcionalidade | P2 | M | concluído |

Sequência sugerida: AL-01 → AL-02/AL-03 → AL-04 → AL-06 → AL-05 → AL-07 → demais → AL-14 (último).

---

## Qualidade e correções

### AL-01 · Testes automatizados do núcleo
- **Problema:** o CI verifica apenas tipos, build e layout em dispositivos móveis. O loop agêntico, as rotas da API,
  a conversão de mensagens do provedor compatível com OpenAI e a memória não têm testes; regressões passam despercebidas.
- **Proposta:** suíte com Vitest cobrindo o núcleo (`core/`) sem chamadas externas: LLM demo com atrasos desativados,
  `fetch` simulado para o provedor OpenAI e servidor MCP embutido via transporte em memória.
- **Critérios de aceite:**
  - `npm test` executa a suíte localmente em poucos segundos;
  - cobertos: calculadora, ranking e CRUD de memória, conversão e streaming do provedor OpenAI, rotas de LLMs e agentes
    (incluindo validação e ocultação de chaves), execução completa com a LLM demo, aprovação humana, limite de
    iterações, ferramentas MCP embutidas e migração de dados da versão 1;
  - o CI executa a suíte em todo push e pull request.
- **Resultado:** 48 testes em 7 arquivos (`core/tests/`), executados em cerca de 1 segundo. A suíte revelou e
  corrigiu dois defeitos: a aprovação humana podia se perder quando respondida imediatamente (o receptor era
  registrado depois do aviso) e dados salvos vazios resultavam em uma plataforma sem agentes.

### AL-02 · Ranking de memória mais robusto
- **Problema:** a busca compara termos exatos; variações da mesma palavra ("prefiro" e "prefere") não se encontram.
- **Proposta:** normalização por radical (stemming simples para português) e pontuação BM25, mantendo o detalhamento
  da pontuação exibido no laboratório de recuperação.
- **Critérios de aceite:** consultas com flexões verbais e plural/singular recuperam a memória esperada; testes cobrindo os casos.
- **Resultado:** radicalizador leve para português, similaridade parcial por prefixo comum e BM25 normalizado como
  componente de relevância (`core/memory.ts`). O laboratório de recuperação exibe a relevância BM25.

### AL-03 · Episódios de memória sem acúmulo de conteúdo
- **Problema:** o resumo episódico inclui o início da resposta final, que pode conter trechos de episódios anteriores
  recuperados, gerando memórias longas e repetitivas.
- **Proposta:** registrar apenas tarefa, ferramentas usadas, número de iterações e resultado em uma frase; excluir
  episódios da recuperação automática por padrão (configurável por agente).
- **Critérios de aceite:** episódios com no máximo ~200 caracteres e sem conteúdo de outros episódios; teste de regressão.
- **Resultado:** episódios limitados a 220 caracteres (tarefa, iterações, ferramentas e primeira frase da resposta) e
  excluídos do recall automático, com a opção "Episódios no recall" por agente.

---

## Funcionalidades

### AL-04 · Comparação de LLMs e agentes lado a lado
- **Problema:** comparar modelos ou prompts exige executar uma configuração por vez e cruzar dados na auditoria.
- **Proposta:** tela "Comparar" que executa a mesma tarefa em paralelo em 2 a 4 combinações (agente × LLM) e apresenta
  uma tabela com tokens, custo estimado, duração, iterações, ferramentas chamadas e resposta final, com acesso à
  execução completa de cada uma.
- **Critérios de aceite:** execuções paralelas independentes; resultado comparativo exportável em JSON; funciona no modo
  servidor e no navegador.
- **Resultado:** rotas `/api/compare` (iniciar, consultar e listar), troca de LLM por execução sem alterar o agente e
  tela "Comparar" com progresso ao vivo, tabela de métricas com destaque do menor valor e exportação em JSON.

### AL-05 · Multiagente
- **Problema:** a plataforma não demonstra delegação entre agentes, conceito central de frameworks como LangGraph e Strands.
- **Proposta:** permitir que um agente use outros agentes como ferramentas (`agent__<nome>`), com execução filha
  vinculada à execução pai; visualizar a delegação no grafo e na linha do tempo; limite de profundidade.
- **Critérios de aceite:** execução pai mostra as execuções filhas com tokens agregados; auditoria registra a cadeia de
  delegação; proteção contra recursão infinita.
- **Resultado:** ferramenta `agent__<id>` por agente (`core/agent/delegation.ts`), habilitada em "Delegar para agentes"
  no editor. Cada delegação cria uma execução filha vinculada à pai (profundidade, cadeia e tokens agregados), com
  limite de 2 níveis, bloqueio de delegação circular e cancelamento em cascata. A linha do tempo acompanha a filha ao
  vivo, o grafo ganha nós de agentes e a auditoria registra a cadeia (`agent.delegated`). O agente "Coordenador
  (offline)" demonstra o recurso sem chave de API e é adicionado aos dados existentes pela migração para a versão 3.

### AL-06 · Ferramentas de servidor do Claude
- **Problema:** no modo navegador, `http_fetch` só acessa sites com CORS liberado, o que limita agentes de pesquisa.
- **Proposta:** habilitar por agente as ferramentas de servidor da Anthropic (`web_search` e `web_fetch`), executadas
  na infraestrutura da Anthropic; exibir buscas e páginas lidas na linha do tempo.
- **Critérios de aceite:** disponível apenas para LLMs Anthropic; resultados e citações visíveis; tratamento de erros
  das ferramentas de servidor.
- **Resultado:** `web_search` e `web_fetch` habilitáveis por agente (`core/tools/server.ts`), nas versões com filtragem
  dinâmica quando o modelo suporta e nas básicas nos demais, com limite de 5 usos por chamada. Chamadas e resultados
  aparecem ao vivo na linha do tempo e no grafo e entram na auditoria; as citações são listadas como "Fontes citadas".
  Erros das ferramentas (devolvidos como resultado, não como exceção) e `pause_turn` são tratados. LLMs de outros
  provedores ignoram essas ferramentas, com registro na auditoria e aviso no editor do agente.

### AL-07 · Gestão da janela de contexto
- **Problema:** o histórico cresce a cada iteração sem visibilidade nem controle, elevando custo e degradando respostas.
- **Proposta:** medidor por iteração (tokens por mensagem, leitura de cache, percentual da janela) e resumo automático
  do histórico ao ultrapassar um limite configurável por agente.
- **Critérios de aceite:** medidor visível no Playground; resumo registrado na linha do tempo e na auditoria; teste do
  disparo do resumo.
- **Resultado:** medidor "Janela de contexto" no Playground (tokens de entrada reais por iteração, percentual da janela,
  leitura de cache e composição estimada entre sistema, ferramentas e histórico) e resumo automático configurável por
  agente (`core/agent/context.ts`). O resumo segue o formato de compactação simples recomendado pela Anthropic: o
  modelo resume o histórico completo, com as mesmas ferramentas, e a próxima chamada começa só com o resumo, sem
  reenviar blocos de raciocínio antigos (o que modelos com raciocínio preservado rejeitam). Proteções: nunca no meio
  de uma rodada de ferramentas, intervalo mínimo de 2 iterações entre resumos e exigência de que o histórico seja ao
  menos 40% do contexto. A janela vem do catálogo ou do campo opcional na LLM; o modelo demo usa 4 mil tokens.

### AL-08 · Replay passo a passo de execuções
- **Problema:** execuções concluídas só podem ser vistas no estado final.
- **Proposta:** barra de tempo para avançar e retroceder pelos eventos salvos, atualizando grafo, linha do tempo e métricas.
- **Critérios de aceite:** navegação por evento e por iteração; reprodução automática com velocidade ajustável.
- **Resultado:** barra de replay no Playground para execuções concluídas (`web/src/lib/replay.ts`): reprodução no ritmo
  real dos eventos (0,5× a 4×, com pausas longas limitadas a 1,5 s), avanço e retrocesso por evento e por iteração,
  controle deslizante com marcas de iteração e atalhos de teclado (espaço, setas e Shift + setas). Grafo, linha do
  tempo, métricas e medidor de contexto acompanham a posição; pedidos de aprovação antigos não reaparecem.

### AL-09 · Exportar e importar configuração
- **Problema:** no modo navegador os dados existem apenas no `localStorage`; limpar o navegador apaga tudo.
- **Proposta:** exportar e importar agentes, LLMs (sem chaves), prompts, servidores MCP e memórias em JSON versionado.
- **Critérios de aceite:** importação valida o esquema e informa conflitos; chaves nunca são exportadas.

### AL-10 · Prompts de tarefa com variáveis no Playground
- **Problema:** modelos de tarefa com `{{variáveis}}` não têm onde ser preenchidos.
- **Proposta:** seletor de modelo de tarefa no Playground com formulário gerado a partir das variáveis.
- **Critérios de aceite:** todas as variáveis exigidas antes da execução; texto final visível antes de enviar.

### AL-11 · Aprovação humana por ferramenta
- **Problema:** a aprovação é tudo ou nada por agente.
- **Proposta:** política por ferramenta (sempre permitir, pedir aprovação, bloquear).
- **Critérios de aceite:** política aplicada também a ferramentas MCP; decisões registradas na auditoria.

### AL-12 · Preços de modelos compatíveis com OpenAI
- **Problema:** o custo estimado ignora modelos fora do catálogo da Anthropic.
- **Proposta:** campos opcionais de preço por milhão de tokens (entrada e saída) na configuração da LLM.
- **Critérios de aceite:** custo estimado considera os preços informados; LLMs sem preço aparecem como "não estimado".

### AL-13 · Busca semântica de memória com embeddings
- **Problema:** mesmo com melhor ranking lexical, sinônimos e paráfrases não são recuperados.
- **Proposta:** provedor de embeddings opcional, com comparação entre busca lexical e semântica no laboratório de recuperação.
- **Critérios de aceite:** funciona sem embeddings (fallback lexical); a pontuação de cada método fica visível.

### AL-15 · Servidores MCP remotos via conector da API do Claude
- **Problema:** no modo navegador, a conexão com um servidor MCP remoto sai da própria página e depende de o servidor
  permitir CORS. Servidores como o do Resend (`https://mcp.resend.com/mcp`) podem recusar, e a conexão falha com
  "Failed to fetch".
- **Proposta:** opção "conectar pela Anthropic" no servidor MCP: em agentes com LLM Anthropic, o servidor é enviado na
  requisição (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`) e a própria API do Claude faz a conexão,
  sem passar pelo navegador. Chamadas e resultados (`mcp_tool_use` / `mcp_tool_result`) aparecem na linha do tempo,
  como as ferramentas de servidor.
- **Critérios de aceite:** servidor MCP sem CORS utilizável no modo navegador com LLM Anthropic; chave do servidor
  enviada só à API da Anthropic; erros de conexão visíveis na linha do tempo.
- **Resultado:** opção "Quem faz a conexão" no cadastro de servidores HTTP (`core/mcp/remote.ts`). Com "API da
  Anthropic", o Agent Lab não abre conexão: o servidor vai em `mcp_servers` (com o token extraído do cabeçalho
  Authorization) e um `mcp_toolset` por servidor, respeitando ferramentas habilitadas individualmente. Chamadas e
  resultados (`mcp_tool_use` / `mcp_tool_result`) aparecem ao vivo na linha do tempo e no grafo e entram na auditoria;
  LLMs de outros provedores ignoram esses servidores, com aviso no editor e registro na auditoria. O modelo pronto do
  Resend já vem com essa opção.

---

## Infraestrutura

### AL-14 · Publicação do servidor na AWS
- **Problema:** a plataforma roda apenas no navegador: cada usuário informa a própria chave, os dados ficam no
  navegador e as execuções terminam ao fechar a aba. Não há servidor próprio, autenticação nem banco de dados.
- **Proposta:** versão privada em contêiner na AWS (App Runner ou ECS Fargate), servindo interface e API com HTTPS,
  mantendo o GitHub Pages como demonstração pública.
  - autenticação (Cognito ou OIDC no balanceador) e CORS restrito ao domínio da aplicação;
  - chaves de API no Secrets Manager, nunca no repositório nem no navegador;
  - persistência em banco (DynamoDB ou Postgres no RDS);
  - limites de uso por usuário (execuções por dia e teto de tokens) para controlar gastos;
  - lista fechada de servidores MCP locais (`stdio`) permitidos, se esse transporte voltar;
  - Dockerfile e workflow de publicação.
- **Ponto de partida:** o servidor Node local (`server/`, com persistência em arquivo, rotas HTTP/SSE e transporte MCP
  `stdio`) foi removido para simplificar a plataforma enquanto não havia uso. Ele pode ser recuperado do histórico do
  Git no commit `f4207f3` (`git checkout f4207f3 -- server`), e o núcleo continua independente do hospedeiro, com
  armazenamento plugável.
- **Restrição conhecida:** execuções ao vivo, aprovações pendentes e streaming ficam na memória do processo; a primeira
  versão deve rodar em uma única instância. Escalar horizontalmente exige mover esse estado para um serviço externo.
- **Critérios de aceite:** acesso apenas autenticado; dados preservados após reinício do contêiner; chaves fora do
  código; limites de uso aplicados e registrados na auditoria; publicação automatizada a partir da `main`.
