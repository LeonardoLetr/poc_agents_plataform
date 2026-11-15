# Guia de estilo: Painel SaaS claro e denso

Especificação visual reutilizável para dashboards e ferramentas internas. Pode ser entregue integralmente a um
agente de código como instrução de estilo. Os valores de cor e medida são aproximações calibradas a partir de uma
referência visual e podem ser ajustados por produto.

---

## Prompt de aplicação

> Aplique o estilo descrito neste documento à interface. Trata-se de um painel SaaS claro, neutro e denso:
> fundo branco, bordas finas em cinza claro em vez de sombras, tipografia sans-serif pequena com hierarquia por
> peso, um único azul como cor de ação e cores semânticas usadas apenas em etiquetas de status, ícones e barras de
> progresso. Siga os tokens, a anatomia dos componentes e o checklist ao final. Não introduza gradientes, sombras
> fortes, fontes serifadas ou cores fora da paleta.

---

## 1. Princípios

1. **Neutro primeiro.** Quase tudo é branco e cinza; a cor aparece só onde carrega significado (status, categoria, ação).
2. **Bordas, não sombras.** Superfícies são separadas por linhas de 1px. Sombras, quando existem, são quase imperceptíveis.
3. **Densidade controlada.** Texto base de 13px, controles de 32px de altura, espaçamento em múltiplos de 4px.
4. **Hierarquia por peso e cor**, não por tamanho. Títulos são pequenos (15–18px) e semibold; números de destaque são o único texto grande.
5. **Informação estruturada em cartões repetíveis**: o mesmo esqueleto (cabeçalho, conteúdo, rodapé) em todo cartão.

## 2. Estrutura da aplicação (shell)

```
┌─────────────┬──────────────────────────────────────────────────────────┐
│ Sidebar     │ Barra superior: breadcrumb · busca (⌘K) · ações · CTA    │
│ 220–240px   ├──────────────────────────────────────────────────────────┤
│             │ Cabeçalho da página: título + subtítulo · avatares        │
│ grupos de   │ Linha de KPIs (3–4 cartões)                               │
│ navegação   │ Barra de abas + filtros                                  │
│             │ Conteúdo: quadro em colunas, tabela ou grade de cartões   │
│ rodapé:     │                                                          │
│ ajuda,      │                                                          │
│ config,     │                                                          │
│ usuário     │                                                          │
└─────────────┴──────────────────────────────────────────────────────────┘
```

- Fundo da área de conteúdo: branco. Sidebar: branco ou cinza levíssimo, separada por borda de 1px.
- Barra superior com 48–52px de altura, borda inferior de 1px.
- Conteúdo com padding horizontal de 20–24px e largura máxima de ~1440px.

## 3. Cores

### Neutros (escala zinc/slate)

| Token | Hex | Uso |
|---|---|---|
| `bg` | `#FFFFFF` | Fundo do conteúdo, cartões |
| `bg-subtle` | `#FAFAFA` | Sidebar, fundo de colunas do quadro |
| `bg-muted` | `#F4F4F5` | Item ativo da navegação, aba ativa, hover |
| `border` | `#E4E4E7` | Bordas de cartões, inputs, divisores |
| `border-strong` | `#D4D4D8` | Bordas em hover, botões secundários |
| `text-muted` | `#A1A1AA` | Placeholders, metadados terciários |
| `text-secondary` | `#71717A` | Rótulos, legendas, subtítulos |
| `text` | `#3F3F46` | Texto de corpo |
| `text-strong` | `#18181B` | Títulos, valores, itens ativos |

### Ação

| Token | Hex | Uso |
|---|---|---|
| `primary` | `#2563EB` | Botão principal, links, foco |
| `primary-hover` | `#1D4ED8` | Hover do botão principal |
| `primary-soft` | `#EFF6FF` | Fundo de seleção |

### Semânticas (sempre em versão "texto forte + fundo suave")

| Estado | Texto | Fundo | Exemplos de etiqueta |
|---|---|---|---|
| Sucesso | `#15803D` | `#F0FDF4` | Pago, Concluído, Depositado |
| Atenção | `#B45309` | `#FFFBEB` | Pendente, Em andamento |
| Erro | `#B91C1C` | `#FEF2F2` | Atrasado, Falhou |
| Destaque | `#6D28D9` | `#F5F3FF` | No prazo, Em análise |
| Laranja | `#C2410C` | `#FFF7ED` | Prioridade, Investimentos |

Barras de progresso e gráficos usam a cor sólida correspondente (`#22C55E`, `#F97316`, `#8B5CF6`, `#3B82F6`).
Ícones de categoria podem usar quadrados coloridos sólidos (preto, azul, laranja, verde) com ícone branco.

## 4. Tipografia

- Família única sans-serif geométrica: **Inter** (alternativas: Geist, SF Pro). Sem serifas na interface.
- Números com `font-variant-numeric: tabular-nums`.

| Papel | Tamanho | Peso | Cor | Observação |
|---|---|---|---|---|
| Valor de KPI | 28px | 600 | `text-strong` | `letter-spacing: -0.02em` |
| Título da página | 16–18px | 600 | `text-strong` | |
| Valor em cartão | 15–16px | 600 | `text-strong` | |
| Corpo / navegação | 13px | 400–500 | `text` | item ativo em 500 |
| Rótulo / legenda | 12px | 400 | `text-secondary` | |
| Rótulo de categoria | 10–11px | 500 | `text-secondary` | CAIXA ALTA, `letter-spacing: 0.04em` |
| Etiqueta de status | 10–11px | 500 | semântica | |

## 5. Forma e espaçamento

- Grade de 4px. Espaços mais usados: 4, 8, 12, 16, 20, 24.
- Raios: cartões 10–12px; colunas do quadro 10px; botões e inputs 8px; etiquetas 4–6px; avatares 50%.
- Altura de controles: 32px (botões, inputs, seletores); 28px em barras compactas.
- Sombra: no máximo `0 1px 2px rgba(0,0,0,0.04)`. Superfícies elevadas (menus, modais) podem usar `0 8px 24px rgba(0,0,0,0.08)`.

## 6. Componentes

### Sidebar
- Logo pequeno (ícone 18px + nome em 15px) e botão quadrado de recolher à direita.
- Itens: ícone de contorno 16px + rótulo 13px, altura 32px, raio 8px.
- Item ativo: fundo `bg-muted`, texto `text-strong` 500. Hover: fundo `bg-muted` mais leve.
- Grupos com rótulo em 12px `text-secondary` e chevron para recolher; subitens recuados com contador alinhado à direita (12px, `text-muted`).
- Ponto vermelho de 6px para indicar pendência.
- Rodapé: links de ajuda e configurações, e um cartão do usuário (avatar, nome, e-mail) com borda.

### Barra superior
- Breadcrumb com ícones pequenos: níveis anteriores em `text-secondary`, nível atual em `text-strong` 500.
- Campo de busca de ~260px com ícone de lupa e atalho `⌘K` em etiqueta de teclado (borda, 11px).
- Ações secundárias como botões de texto com ícone (Exportar, Compartilhar).
- Um único botão principal sólido em `primary`, à direita.

### Botões
- **Principal:** fundo `primary`, texto branco 13px 500, altura 32px, raio 8px, padding horizontal 12px.
- **Secundário:** fundo branco, borda `border`, texto `text`, ícone à esquerda.
- **Fantasma:** sem borda, texto `text-secondary`, fundo `bg-muted` no hover.
- **Ícone:** quadrado de 28–32px, raio 8px, borda opcional.
- **Adicionar (fim de lista):** largura total, borda tracejada `border`, texto 12px `text-secondary`, "+ Adicionar item".

### Campos
- Altura 32px, borda `border`, fundo branco, texto 13px; foco com borda `primary` e anel de 3px em `primary-soft`.

### Cartão de KPI
- Borda `border`, raio 12px, padding 16px.
- Cabeçalho: ícone colorido pequeno + rótulo 12px `text-secondary`. À direita, variação (`↑ 8,2%`) em etiqueta verde ou um botão de ícone (`⋯`, `↗`).
- Valor de 28px semibold; legenda de 12px abaixo (com o trecho positivo em verde).
- Rodapé com microvisualização: histograma de pontos, barras finas ou barra de progresso de 6px com raio total.

### Abas
- Título da seção à esquerda (13px 600), seguido de divisor vertical e abas com ícone.
- Aba ativa: fundo `bg-muted`, texto `text-strong`; inativas em `text-secondary`.
- Filtros à direita como botões secundários (Filtrar, seletor de período).

### Quadro em colunas (kanban)
- Colunas com fundo `bg-subtle`, raio 10px, padding 6px, gap de 12px entre colunas.
- Cabeçalho da coluna: ícone + título 12px 600 + contador em etiqueta neutra + menu `⋯` à direita.
- Cartões empilhados com gap de 6px.

### Cartão de item
```
┌──────────────────────────────────┐
│ ⌂ CATEGORIA            [Status]  │  rótulo em caixa alta + etiqueta semântica
│ Descrição do item                │  12–13px, text
│ $1.250,00  /de $10.000           │  valor 15–16px 600 + complemento text-muted
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░            │  barra de progresso opcional (3px)
│ 📅 23 out 2026        meta curta │  rodapé 11px text-secondary
└──────────────────────────────────┘
```
- Fundo branco, borda `border`, raio 8–10px, padding 12px.

### Etiquetas de status
- Fundo suave + texto forte da mesma família semântica, 10–11px 500, raio 4–6px, padding 2px 6px. Sem borda ou com borda tênue da mesma cor.

### Avatares
- Círculos de 20–24px sobrepostos (−6px), borda branca de 2px, e um contador `+2` em círculo neutro.

### Gráficos
- Minimalistas, sem eixos nem grades: barras finas (2–3px) em azul, histograma de pontos em laranja, barras de progresso em verde.
- A cor do gráfico acompanha a categoria do cartão.

## 7. Ícones
- Conjunto de contorno com traço de 1.5px (Lucide, Heroicons Outline), 14–16px em navegação e cartões.
- Cor padrão `text-secondary`; `text-strong` quando ativo.

## 8. Interação e movimento
- Transições de 120–160ms em cor de fundo e borda; nada de escala ou deslocamento exagerado.
- Hover em linhas e itens de navegação: fundo `bg-muted`.
- Foco visível em todos os controles: anel de 3px `primary-soft` + borda `primary`.

## 9. Responsividade
- Abaixo de 1024px, a sidebar recolhe para ícones ou vira menu no topo.
- KPIs: 3 colunas → 2 → 1. Quadro: 4 colunas → 2 → 1, sem rolagem horizontal da página.
- A barra superior esconde ações secundárias em telas pequenas, mantendo busca e botão principal.

## 10. Fazer / evitar

| Fazer | Evitar |
|---|---|
| Bordas de 1px para separar superfícies | Sombras marcadas e cartões "flutuando" |
| Cor apenas em status, ícones e progresso | Fundos coloridos em grandes áreas |
| Um botão principal azul por tela | Vários botões coloridos competindo |
| Títulos pequenos e semibold | Títulos grandes, serifados ou decorativos |
| Rótulos de categoria em caixa alta pequena | Texto em caixa alta em frases longas |
| Gráficos mínimos, sem eixos | Gráficos com grades, legendas extensas e 3D |

## 11. Checklist de aplicação

- [ ] Fonte única sans-serif (Inter) com números tabulares.
- [ ] Fundo branco, sidebar `#FAFAFA`, bordas `#E4E4E7`, sem gradientes.
- [ ] Barra superior com breadcrumb, busca com `⌘K` e um único botão principal azul.
- [ ] Navegação com item ativo em `bg-muted`, grupos com rótulo e contadores.
- [ ] Cabeçalho de página com título de 16–18px e subtítulo de 12px.
- [ ] KPIs com valor de 28px, variação em etiqueta e microvisualização.
- [ ] Status como etiquetas suaves (fundo claro + texto forte), 10–11px.
- [ ] Listas em cartões com o mesmo esqueleto: categoria, título, valor, rodapé.
- [ ] Controles com 32px de altura e raio de 8px; foco visível.
- [ ] Nenhuma página com rolagem horizontal em telas de 320px.
