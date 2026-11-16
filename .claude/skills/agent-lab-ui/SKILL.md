---
name: agent-lab-ui
description: Guia do sistema visual do Agent Lab. Consultar ao criar ou alterar telas, componentes ou animações em web/src.
---

# Sistema visual do Agent Lab

O estilo segue a especificação [`docs/style-guides/painel-saas-claro.md`](../../../docs/style-guides/painel-saas-claro.md):
painel denso com tema claro (papel bege, cartões brancos) e escuro (grafite quente), superfícies separadas por bordas
de 1px, tipografia Inter e azul como única cor de ação.

## Mapeamento para o código

| Conceito do guia | Implementação |
|---|---|
| Tokens de cor | `web/src/index.css`: tema claro em `@theme`, escuro em `:root[data-theme="escuro"]` (`ink-950` = fundo, `ink-100` = texto forte, `surface` = cartões, `accent` = azul) |
| Seleção e persistência do tema | `web/src/lib/theme.ts` (preferência salva → preferência do sistema; `?tema=claro\|escuro`) |
| Alternância de tema | botão na `TopBar` |
| Sidebar com grupos e contadores | `web/src/components/Sidebar.tsx` |
| Barra superior (breadcrumb, busca ⌘K, ação principal) | `web/src/components/TopBar.tsx` |
| Botões, campos, etiquetas de status, modal | `web/src/components/ui.tsx` |
| Cartão de KPI e micrográficos | `web/src/components/kpi.tsx` |
| Quadro em colunas | `web/src/pages/Memory.tsx` (quadro de memórias) |
| Cartão de item | cartões de agentes (Visão geral), ferramentas (linha do tempo) e memórias |

## Regras do projeto

- Cada página começa com `PageHeader` (título de 18px e subtítulo de 13px); o rótulo de contexto aparece no breadcrumb.
- No máximo um botão `primary` por tela.
- Nenhuma cor fixa em componentes (`bg-white`, `#fff`, `black/…`): usar `surface` e a escala `ink`, para funcionar nos dois temas.
- Etiquetas de status usam `Badge` com a cor semântica; etiquetas informativas usam `Badge` neutro.
- Animações apenas para indicar mudança ou atividade (execução do agente, fluxo no grafo, entrada de itens).
- Nenhuma página pode exceder a largura da tela: `node web/scripts/check-mobile.cjs` roda no CI e bloqueia a publicação.
