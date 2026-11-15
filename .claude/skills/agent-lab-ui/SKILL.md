---
name: agent-lab-ui
description: Guia do sistema visual do Agent Lab. Consultar ao criar ou alterar telas, componentes ou animações em web/src.
---

# Sistema visual do Agent Lab

O estilo segue a especificação [`docs/style-guides/painel-saas-claro.md`](../../../docs/style-guides/painel-saas-claro.md):
painel claro e denso, superfícies brancas separadas por bordas de 1px, tipografia Inter e azul como única cor de ação.

## Mapeamento para o código

| Conceito do guia | Implementação |
|---|---|
| Tokens de cor | `web/src/index.css` (`ink-950` = branco ... `ink-100` = texto forte; `accent` = azul) |
| Sidebar com grupos e contadores | `web/src/components/Sidebar.tsx` |
| Barra superior (breadcrumb, busca ⌘K, ação principal) | `web/src/components/TopBar.tsx` |
| Botões, campos, etiquetas de status, modal | `web/src/components/ui.tsx` |
| Cartão de KPI e micrográficos | `web/src/components/kpi.tsx` |
| Quadro em colunas | `web/src/pages/Memory.tsx` (quadro de memórias) |
| Cartão de item | cartões de agentes (Visão geral), ferramentas (linha do tempo) e memórias |

## Regras do projeto

- Cada página começa com `PageHeader` (título de 18px e subtítulo de 13px); o rótulo de contexto aparece no breadcrumb.
- No máximo um botão `primary` por tela.
- Etiquetas de status usam `Badge` com a cor semântica; etiquetas informativas usam `Badge` neutro.
- Animações apenas para indicar mudança ou atividade (execução do agente, fluxo no grafo, entrada de itens).
- Nenhuma página pode exceder a largura da tela: `node web/scripts/check-mobile.cjs` roda no CI e bloqueia a publicação.
