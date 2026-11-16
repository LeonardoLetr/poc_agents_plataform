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
| AL-04 | Comparação de LLMs e agentes lado a lado | Funcionalidade | P1 | M | a fazer |
| AL-05 | Multiagente: agente como ferramenta e supervisor | Funcionalidade | P1 | G | a fazer |
| AL-06 | Ferramentas de servidor do Claude (web search e web fetch) | Funcionalidade | P1 | P | a fazer |
| AL-07 | Gestão da janela de contexto (medidor e resumo) | Funcionalidade | P1 | M | a fazer |
| AL-08 | Replay passo a passo de execuções | Funcionalidade | P2 | M | a fazer |
| AL-09 | Exportar e importar configuração | Funcionalidade | P2 | P | a fazer |
| AL-10 | Prompts de tarefa com variáveis no Playground | Funcionalidade | P2 | P | a fazer |
| AL-11 | Aprovação humana por ferramenta | Melhoria | P2 | P | a fazer |
| AL-12 | Preços de modelos compatíveis com OpenAI | Melhoria | P3 | P | a fazer |
| AL-13 | Busca semântica de memória com embeddings | Funcionalidade | P3 | M | a fazer |

Sequência sugerida: AL-01 → AL-02/AL-03 → AL-04 → AL-06 → AL-05 → AL-07 → demais.

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

### AL-05 · Multiagente
- **Problema:** a plataforma não demonstra delegação entre agentes, conceito central de frameworks como LangGraph e Strands.
- **Proposta:** permitir que um agente use outros agentes como ferramentas (`agent__<nome>`), com execução filha
  vinculada à execução pai; visualizar a delegação no grafo e na linha do tempo; limite de profundidade.
- **Critérios de aceite:** execução pai mostra as execuções filhas com tokens agregados; auditoria registra a cadeia de
  delegação; proteção contra recursão infinita.

### AL-06 · Ferramentas de servidor do Claude
- **Problema:** no modo navegador, `http_fetch` só acessa sites com CORS liberado, o que limita agentes de pesquisa.
- **Proposta:** habilitar por agente as ferramentas de servidor da Anthropic (`web_search` e `web_fetch`), executadas
  na infraestrutura da Anthropic; exibir buscas e páginas lidas na linha do tempo.
- **Critérios de aceite:** disponível apenas para LLMs Anthropic; resultados e citações visíveis; tratamento de erros
  das ferramentas de servidor.

### AL-07 · Gestão da janela de contexto
- **Problema:** o histórico cresce a cada iteração sem visibilidade nem controle, elevando custo e degradando respostas.
- **Proposta:** medidor por iteração (tokens por mensagem, leitura de cache, percentual da janela) e resumo automático
  do histórico ao ultrapassar um limite configurável por agente.
- **Critérios de aceite:** medidor visível no Playground; resumo registrado na linha do tempo e na auditoria; teste do
  disparo do resumo.

### AL-08 · Replay passo a passo de execuções
- **Problema:** execuções concluídas só podem ser vistas no estado final.
- **Proposta:** barra de tempo para avançar e retroceder pelos eventos salvos, atualizando grafo, linha do tempo e métricas.
- **Critérios de aceite:** navegação por evento e por iteração; reprodução automática com velocidade ajustável.

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
