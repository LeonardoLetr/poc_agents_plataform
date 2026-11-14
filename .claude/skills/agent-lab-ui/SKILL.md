---
name: agent-lab-ui
description: Guia do sistema visual do Agent Lab. Consultar ao criar ou alterar telas, componentes ou animações em web/src.
---

# Sistema visual do Agent Lab

Interface minimalista em tons quentes, orientada à leitura de informação técnica. A estrutura combina
navegação compacta com bordas de 1px e conteúdo organizado em cartões.

## Cores

| Token | Valor | Uso |
|---|---|---|
| `ink-950` | `#f7f5ef` | Fundo da página |
| `ink-900` | `#f1eee6` | Barra lateral, blocos de código |
| `ink-100` | `#1f1e1c` | Títulos |
| `ink-300` / `ink-400` | `#5f5a50` / `#6f6a5f` | Texto de apoio / secundário |
| `accent` | `#c96442` | Ação principal e destaques pontuais |
| `ok`, `warn`, `bad`, `info`, `mcp`, `memory` | dessaturadas | Indicação de estado |

- Na escala `ink`, 950 é o tom mais claro e 100 o mais escuro.
- Superfícies de conteúdo usam `Card` (fundo branco, borda `black/8%`, sombra mínima).
- Cada tela tem no máximo um botão `primary`; as demais ações usam `ghost` ou `subtle`.
- Cores semânticas são reservadas para estado. Etiquetas informativas usam `Badge` neutro.
- Não utilizar gradientes coloridos, efeitos de brilho, desfoque decorativo ou fundos animados.

## Tipografia

- Títulos de página e de seção: Source Serif 4, peso regular (`font-serif font-normal`).
  Para destacar uma palavra, usar itálico com a classe `.text-gradient` (cor `accent`).
- Interface: Geist.
- Identificadores, valores e rótulos em caixa alta: Geist Mono.
- O raciocínio do modelo é exibido em serifa itálica, diferenciando-o da resposta.

## Movimento

- Animações apenas para comunicar mudança ou atividade: entrada de itens, execução em andamento
  (anel no nó do agente, `LiveDot`, indicador "pensando…") e fluxo nas arestas do grafo.
- Estado ativo é indicado por contorno na cor do contexto (`.beam`).
- A preferência `prefers-reduced-motion` é respeitada globalmente em `index.css`.

## Responsividade

- Nenhuma página pode exceder a largura da tela (sem rolagem horizontal).
- Itens de grid têm `min-width: 0`; cabeçalhos com múltiplos elementos usam `flex-wrap`;
  elementos de tamanho fixo se ajustam à largura da janela.
- `node web/scripts/check-mobile.cjs` valida 9 páginas em 3 dispositivos. A verificação roda no CI
  e é pré-requisito para a publicação no GitHub Pages.

## Componentes

- Primitivos em `web/src/components/ui.tsx`; efeitos em `web/src/components/effects.tsx`.
  Reutilizar os existentes antes de criar novos.
- Toda página começa com `PageHeader` (rótulo em mono, título em serifa e descrição).
