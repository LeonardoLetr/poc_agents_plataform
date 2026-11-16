# Diretrizes de código TypeScript

Como escrever e revisar a lógica do Agent Lab: o núcleo (`core/`) e os módulos TypeScript da interface que não são
componentes (`web/src/lib/`). Componentes React seguem o guia visual em `.claude/skills/agent-lab-ui`.

As regras valem para todo código novo e para trechos existentes quando forem alterados. A adequação do código atual é
feita aos poucos pelo item AL-16 do backlog, sempre com a suíte de testes como rede de segurança.

Termos: **deve** e **não deve** são obrigatórios; **prefira** e **evite** admitem exceção justificada no código ou na
revisão.

---

## 1. Princípios

1. **A solução mais simples que resolve o problema de hoje.** Não deve existir código para requisitos que ainda não
   existem: parâmetros "para o futuro", pontos de extensão sem segundo uso, configurações que ninguém altera.
2. **O compilador prova o que o código assume.** Se uma suposição não está no tipo, ela é um defeito esperando para
   acontecer. Casts escondem suposições; tipos as expõem.
3. **Validar na entrada, confiar no interior.** Dados externos são convertidos uma única vez em tipos confiáveis. Daí
   para dentro, nada de checagens repetidas.
4. **Decidir em funções puras; agir nas bordas.** Regras recebem dados e devolvem dados. Gravar, auditar, emitir
   eventos e chamar a rede fica concentrado em poucos pontos.
5. **Módulos profundos.** Uma interface pequena escondendo bastante trabalho vale mais que muitas camadas finas que só
   repassam chamadas.
6. **Falhas esperadas aparecem no tipo.** Exceção é para o inesperado.
7. **Testar o comportamento,** não a implementação.
8. **Código é lido muito mais vezes do que escrito.** Nomes claros dispensam comentários; comentários explicam o
   porquê.

---

## 2. Tipos

### Configuração

O `tsconfig` deve ter, além de `strict`:

| Opção | Por quê |
|---|---|
| `noUncheckedIndexedAccess` | `lista[i]` e `mapa[chave]` podem não existir; o tipo passa a dizer isso. |
| `exactOptionalPropertyTypes` | Distingue "campo ausente" de "campo com `undefined`", comum em dados salvos e respostas de API. |
| `noImplicitReturns`, `noFallthroughCasesInSwitch` | Todo caminho retorna; nenhum `case` vaza para o seguinte por engano. |

### Regras

- **`type` por padrão.** Use `interface` só quando precisar de `extends` entre formas de objeto.
- **Uniões de literais no lugar de `enum`:** `type Provider = "anthropic" | "openai" | "demo"`.
- **Estados e eventos são uniões discriminadas** por um campo (`type`, `status`, `kind`), não objetos cheios de campos
  opcionais que permitem combinações impossíveis.
- **`switch` sobre uniões deve ser exaustivo,** com verificação no `default`:

  ```ts
  function assertNever(value: never): never {
    throw new Error(`Caso não tratado: ${JSON.stringify(value)}`);
  }

  switch (llm.provider) {
    case "anthropic": return callAnthropic(call);
    case "openai": return callOpenAi(call);
    case "demo": return demoTurn(call);
    default: return assertNever(llm.provider); // erro de compilação se um provedor novo não for tratado
  }
  ```

- **`any` não deve ser usado.** Para valores de forma desconhecida, use `unknown` e estreite com `typeof`, `in`,
  verificação de discriminante ou um esquema.
- **Asserções de tipo (`as`) não devem ser usadas,** com duas exceções: `as const` e conversões que a linguagem não
  consegue expressar, sempre com um comentário dizendo por que são seguras. `as unknown as` é proibido.
- **Asserção de não nulo (`!`) não deve ser usada.** Trate a ausência ou estreite antes.
- **Tipos de APIs externas vêm da fonte.** Blocos de mensagens da Anthropic usam os tipos do SDK
  (`Anthropic.Beta.BetaContentBlock`, `BetaToolUseBlock`…), estreitados pelo campo `type`, em vez de formas escritas à
  mão como `as { type: string; id?: string }`.
- **Derive tipos em vez de duplicá-los:** `z.infer<typeof Esquema>`, `Pick`, `Omit`, `ReturnType`, `typeof`. Uma
  forma descrita em dois lugares diverge.

```ts
// Evite: forma inventada e cast
const toolUses = (turn.content as { type: string; id?: string; name?: string }[]).filter((b) => b.type === "tool_use");

// Prefira: tipo do SDK e estreitamento
const toolUses = turn.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use");
```

---

## 3. Fronteiras

Toda entrada externa passa por uma função de leitura que devolve um valor tipado ou falha com uma mensagem clara. As
fronteiras do Agent Lab:

| Fronteira | Como tratar |
|---|---|
| Rotas do núcleo (`core/router.ts`) | Esquema Zod no início do handler; o corpo nunca é usado antes disso. |
| Dados salvos (`localStorage`) | `migrate()` normaliza versões antigas; o resultado deve ser validado antes de virar o `db`. |
| Arquivo importado | Esquema com formato e versão, depois a mesma migração dos dados salvos. |
| Respostas de LLMs | Anthropic: tipos do SDK. Provedores compatíveis com OpenAI: `unknown` lido com esquema. |
| Entrada de ferramentas gerada pelo modelo | Validada contra o esquema da ferramenta antes de executar; erro vira `tool_result` com `is_error`. |
| Resultados de servidores MCP e de `fetch` | `unknown` até ser lido; nunca repassado com cast. |

Depois da fronteira, o código não deve repetir a validação. Se uma função interna precisa checar de novo, o tipo de
entrada dela está errado.

---

## 4. Organização

### Lógica pura × efeitos

- **Decisões ficam em funções puras:** sem `db`, `bus`, `audit`, `emit`, `persist`, `fetch`, `Date.now()` ou
  aleatoriedade. Recebem o que precisam por parâmetro. Exemplos atuais: `shouldCompact`, `summarizeEpisode`, a
  pontuação BM25 da memória.
- **Efeitos ficam no orquestrador.** O loop agêntico decide com funções puras e então grava, audita e emite em pontos
  bem definidos. Uma função que decide não deve também gravar.
- **Estado compartilhado** (`db`, conexões MCP, execuções ao vivo) é alterado por funções do módulo dono, não por
  mutação espalhada pelo código.
- O horário vem por parâmetro (ou de uma única função `now()`) quando a lógica depende dele, para poder ser testada.

### Tamanho e forma

- **Uma função faz uma coisa.** Passando de ~60 linhas ou de três níveis de aninhamento, divida por responsabilidade
  (ler, decidir, executar, registrar), não por contagem de linhas.
- **Um arquivo cobre um assunto.** Acima de ~400 linhas, separe por domínio: rotas por recurso (`routes/agents.ts`,
  `routes/mcp.ts`), loop separado de delegação e de contexto.
- **Retorno antecipado** no lugar de `if/else` aninhado.
- **Dados imutáveis por padrão** (`const`, `readonly` em parâmetros, cópia em vez de mutação) fora dos pontos de
  estado deliberado.

### Abstrações

Uma abstração nova deve se pagar agora. Não devem existir:

- interfaces ou tipos genéricos com uma única implementação e nenhuma segunda prevista no backlog;
- classes com um único método (use uma função);
- funções que só repassam os argumentos para outra;
- fábricas, registros ou configurações para um único caso;
- generalização antes do terceiro uso parecido (duplicar duas vezes é aceitável; na terceira, extraia).

### Dependências

Uma biblioteca nova precisa de ganho claro sobre a plataforma ou sobre poucas linhas próprias. Prefira APIs da
plataforma (`fetch`, `AbortSignal`, `structuredClone`, `crypto.randomUUID`).

---

## 5. Erros e código assíncrono

- **`throw` para o inesperado:** invariantes violadas, configuração impossível, defeitos. Mensagens em português,
  dizendo o que fazer ("Cadastre a chave em LLMs").
- **Falhas esperadas são valores.** Ferramenta que falhou, LLM que recusou, servidor MCP indisponível: retorne uma
  união, sem biblioteca:

  ```ts
  type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
  ```

- **Exceções de terceiros são convertidas na borda** (cliente HTTP, SDK, MCP) para mensagens ou resultados do nosso
  domínio. O interior não lida com classes de erro de bibliotecas.
- **`try/catch` só onde há uma decisão:** converter, registrar ou recuperar. Não deve existir `catch` vazio nem
  `catch` que apenas relança o mesmo erro.
- **Toda promise é aguardada** (`await`) ou descartada de propósito com `void` e um comentário dizendo por quê.
- **Cancelamento usa `AbortSignal`,** repassado até a chamada de rede.

---

## 6. Testes

- **Teste pelo que é observável:** rotas do núcleo (`core.handle`), eventos da execução, dados persistidos ou o
  retorno de funções puras. Não teste funções internas nem quantas vezes algo foi chamado.
- **Simule só as fronteiras:** `fetch` (respostas de LLM e MCP) e o relógio. A LLM demo roda sem atraso nos testes.
- **Funções puras ganham testes unitários diretos,** sem simulação.
- **Toda correção de defeito vem com um teste** que falhava antes da correção.
- **Testes determinísticos:** sem esperas fixas e sem depender da ordem de outros testes; quando o estado é
  compartilhado no arquivo, prepare o que o teste precisa.
- O nome do teste descreve o comportamento, em português: `"bloqueia delegação circular"`.

---

## 7. Nomes e comentários

- **Identificadores em inglês;** comentários, mensagens de erro e textos de interface em português.
- **Nomes descrevem o papel:** funções com verbo (`compactHistory`), booleanos com `is`/`has`/`should`, sem
  abreviações obscuras.
- **Comentários explicam o porquê:** uma restrição externa, uma decisão não óbvia, uma armadilha conhecida.

  ```ts
  // O resumo substitui o histórico inteiro: modelos com raciocínio preservado rejeitam turnos antigos
  // reenviados depois de uma edição no início do histórico.
  ```

- **Não devem existir:** comentários que repetem o código, cabeçalhos decorativos, tom de tutorial ou de propaganda,
  código comentado e `TODO` sem item no backlog.
- **JSDoc curto** em funções exportadas cujo contrato não é óbvio pelo nome e pelos tipos.

---

## 8. Checklist de revisão

Antes de abrir ou aprovar uma mudança, responda:

1. Existe uma forma mais simples de resolver só o problema pedido?
2. Alguma abstração nova tem um único uso?
3. Há `as`, `!` ou `any` novos? Cada `as` restante está justificado?
4. Dados externos são validados na entrada e confiados depois, sem checagens repetidas?
5. As decisões estão em funções puras e os efeitos concentrados?
6. Algum `try/catch` só existe "por garantia"?
7. Alguma promise ficou sem `await` ou `void` justificado?
8. Algum `switch` sobre união não é exaustivo?
9. Os testes cobrem o comportamento novo pelo que é observável, incluindo os erros esperados?
10. Os comentários explicam o porquê, ou só narram o código?
11. A mudança duplica algo que já existe no código?

---

## 9. Ferramentas

- **TypeScript** com as opções da seção 2.
- **typescript-eslint** com a configuração `strict-type-checked`, mais:
  - `no-floating-promises` e `no-misused-promises`: promises esquecidas;
  - `switch-exhaustiveness-check`: uniões tratadas por completo;
  - `consistent-type-assertions` e `no-non-null-assertion`: limita casts e `!`;
  - `no-explicit-any`.
- **Formatação** automática, adotada junto com o lint, para que a revisão discuta lógica e não espaçamento.
- A verificação de tipos, o lint e os testes rodam no CI e bloqueiam a publicação.
