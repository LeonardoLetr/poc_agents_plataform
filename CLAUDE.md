# Agent Lab: instruções para agentes de código

## Convenções de Git

- **Idioma:** nomes de branch e mensagens de commit sempre em inglês. Documentação, comentários de código e textos da
  interface permanecem em português.
- **Branches:** cada funcionalidade ou correção tem a própria branch, criada a partir da `main`, com prefixo do tipo
  e nome descritivo em kebab-case: `feat/`, `fix/`, `test/`, `docs/`, `refactor/`, `chore/`, `ci/`
  (ex.: `feat/model-comparison`, `fix/approval-race`). Não há branch de integração intermediária.
- **Branches dependentes:** quando uma funcionalidade depende de outra ainda não integrada, a nova branch parte da
  anterior; o merge na `main` segue a mesma ordem.
- **`main`:** o merge de uma branch na `main` só é feito com autorização explícita do responsável pelo repositório.
  Todo push na `main` publica o site no GitHub Pages.
- **Commits:** padrão Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`), com
  escopo opcional (`feat(memory): ...`), assunto no imperativo, até ~72 caracteres, e corpo explicando o motivo quando
  relevante.
- **Autoria:** os commits são feitos em nome do responsável pelo repositório; não adicionar linhas de coautoria.

## Código

- A lógica TypeScript (`core/` e `web/src/lib/`) segue `docs/CODIGO.md`: tipos sem casts, validação nas fronteiras,
  decisões em funções puras, sem abstrações antecipadas, testes de comportamento e comentários só sobre o porquê.
- Toda mudança passa pelo checklist da seção 8 desse arquivo antes do merge.

## Validação antes de integrar

```bash
npm run typecheck     # tipos do núcleo (core) e da interface (web)
npm run lint          # typescript-eslint na lógica (core e web/src/lib)
npm run format:check  # formatação (Prettier); `npm run format` corrige
npm test              # suíte do núcleo (Vitest, core/tests)
npm run build         # build da interface
```

Para mudanças visuais, executar também `node web/scripts/check-mobile.cjs` com o build servido em
`http://localhost:4173/poc_agents_plataform` (detalhes em `.claude/skills/agent-lab-ui`).

## Referências

- Arquitetura e funcionalidades: `README.md`
- Backlog priorizado: `docs/BACKLOG.md` (atualizar o status ao concluir um item)
- Diretrizes de código: `docs/CODIGO.md`
- Sistema visual: `.claude/skills/agent-lab-ui` e `docs/style-guides/painel-saas-claro.md`
