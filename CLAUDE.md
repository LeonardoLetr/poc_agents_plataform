# Agent Lab: instruções para agentes de código

## Convenções de Git

- **Idioma:** nomes de branch e mensagens de commit sempre em inglês. Documentação, comentários de código e textos da
  interface permanecem em português.
- **Branches:** `dev` é a branch de integração. Cada mudança é feita em uma branch criada a partir da `dev`, com
  prefixo do tipo e nome descritivo em kebab-case: `feat/`, `fix/`, `test/`, `docs/`, `refactor/`, `chore/`, `ci/`
  (ex.: `feat/model-comparison`, `fix/approval-race`). Depois de validada, a branch é integrada à `dev`.
- **`main`:** recebe mudanças apenas a partir da `dev` e somente quando solicitado. Todo push na `main` publica o site
  no GitHub Pages.
- **Commits:** padrão Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `ci:`), com
  escopo opcional (`feat(memory): ...`), assunto no imperativo, até ~72 caracteres, e corpo explicando o motivo quando
  relevante.
- **Autoria:** os commits são feitos em nome do responsável pelo repositório; não adicionar linhas de coautoria.

## Validação antes de integrar

```bash
npm run typecheck     # tipos de core, server e web
npm test              # suíte do núcleo (Vitest, core/tests)
npm run build         # build do servidor e da interface
```

Para mudanças visuais, executar também `node web/scripts/check-mobile.cjs` com o build servido em
`http://localhost:4173/poc_agents_plataform` (detalhes em `.claude/skills/agent-lab-ui`).

## Referências

- Arquitetura e funcionalidades: `README.md`
- Backlog priorizado: `docs/BACKLOG.md` (atualizar o status ao concluir um item)
- Sistema visual: `.claude/skills/agent-lab-ui` e `docs/style-guides/painel-saas-claro.md`
