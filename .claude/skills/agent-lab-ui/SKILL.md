---
name: agent-lab-ui
description: Sistema visual do Agent Lab. Use ao criar ou alterar qualquer tela, componente ou animação em web/src para manter a identidade (tema escuro de laboratório, Geist/Instrument Serif, efeitos com motion).
---

# Sistema visual do Agent Lab

## Identidade
- Tema escuro de "laboratório": fundo `ink-950`, grade sutil (`.lab-grid`) e o `Aurora` atrás de tudo.
- Superfícies em vidro: classe `.glass` (gradiente branco de 4% para 1.5% e borda `white/7`). Use o componente `Card`.
- Cores semânticas (tokens em `web/src/index.css`):
  - `violet`: LLM / raciocínio
  - `cyan`: usuário / entrada
  - `amber`: ferramentas nativas
  - `pink`: MCP
  - `mint`: sucesso / scratchpad
  - `rose`: erro
  - roxo claro `#a78bfa`: memória
- Tipografia: Geist (UI), Geist Mono (dados, ids, JSON, rótulos pequenos em caixa alta com tracking largo),
  Instrument Serif *itálico* só para destaques editoriais (uma palavra ou expressão por título).

## Movimento
- Biblioteca: `motion` (`import { motion } from "motion/react"`).
- Entradas: spring (stiffness 300, damping 28) com leve `y` e `scale`. Listas escalonadas em 0.04 a 0.06s.
- Estado "ativo/ao vivo": `.beam` (borda com feixe), `LiveDot`, `.shimmer-text`. Nunca mais de um efeito chamativo por componente.
- Respeite `prefers-reduced-motion` (já tratado globalmente no CSS).
- Efeitos prontos ficam em `web/src/components/effects.tsx`. Reaproveite antes de criar outro.

## Componentes
- Use os primitivos de `web/src/components/ui.tsx` (`Button`, `Badge`, `Field`, `Input`, `Modal`, `Toggle`, `PageHeader`...).
- Cada página começa com `PageHeader` (eyebrow em mono + título + descrição didática).
- O tom dos textos é didático: explique o conceito que a tela demonstra.

## Referências
Veja `docs/pesquisa-visual.md` para as bibliotecas e skills que inspiraram estes padrões.
