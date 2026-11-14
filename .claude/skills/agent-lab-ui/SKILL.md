---
name: agent-lab-ui
description: Sistema visual do Agent Lab (minimalista, papel bege, acento terracota). Use ao criar ou alterar qualquer tela, componente ou animação em web/src para manter a identidade.
---

# Sistema visual do Agent Lab: "papel"

Minimalista, quente e calmo, com cara de ferramenta e não de "demo de IA". A estrutura enxuta vem do Linear
(bordas de 1px, sidebar compacta) e os cartões espaçosos vêm de um layout bento.

## Regras
- **Fundo bege** (`ink-950` #f7f5ef), sidebar um tom mais escuro (`ink-900`), **cartões brancos** (`Card` / `.glass`)
  com borda `black/8%` e sombra quase invisível.
- **Um único acento**: terracota `accent` (#c96442). Use-o no botão principal e em poucos destaques.
  **Um botão `primary` por tela**; o resto é `ghost`/`subtle`.
- **Cor só comunica estado**: `ok`, `warn`, `bad`, `info`, `mcp`, `memory` (todas dessaturadas). Etiquetas neutras usam `Badge` sem cor.
- **Proibido**: gradientes coloridos, brilho/glow, neon, blur decorativo, texto em gradiente, fundos animados.
- **Escala ink**: 950 é o fundo mais claro e 100 o texto mais forte (`text-ink-100` títulos, `ink-300` apoio, `ink-400` secundário).

## Tipografia
- Títulos de página: **Source Serif 4**, peso normal (`font-serif font-normal`). Destaque de uma palavra: itálico + `.text-gradient` (que aqui é só a cor terracota).
- Interface: **Geist**. Dados, ids e rótulos pequenos em caixa alta: **Geist Mono**.
- O raciocínio do modelo aparece em serifa itálica (como uma anotação à mão).

## Movimento
- `motion` só quando comunica algo: algo mudou (entrada de itens), algo está rodando (anel girando no agente, `LiveDot`, "pensando…").
- Estado ativo = borda/anel na cor do contexto (`.beam` agora é só um contorno), nunca brilho.
- Respeite `prefers-reduced-motion` (já tratado no CSS).

## Celular
- **Nada pode ser mais largo que a tela** (sem rolagem lateral). Itens de grid já têm `min-width: 0`; cabeçalhos com vários itens usam `flex-wrap`;
  elementos com tamanho fixo (diagramas) encolhem com a largura da janela.
- `node web/scripts/check-mobile.cjs` testa 9 páginas em 3 celulares e roda no CI; o deploy do Pages não publica se falhar.

## Componentes
- Primitivos em `web/src/components/ui.tsx`; efeitos em `effects.tsx`. Reaproveite antes de criar outro.
- Toda página começa com `PageHeader` (eyebrow em mono, título serifado, descrição didática).
