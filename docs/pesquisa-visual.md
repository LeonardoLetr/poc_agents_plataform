# Pesquisa: repositórios de animação, visual e *skills* de design

Pesquisa feita em novembro de 2026 sobre os repositórios que aparecem com frequência em posts no X sobre
"skills e tools para deixar o visual melhor". Os números de estrelas vêm de agregadores e mudam rápido;
confira no GitHub antes de adotar.

## 1. *Skills* de design para agentes de código (Claude Code e similares)

Uma *skill* é uma pasta com um `SKILL.md` (instruções + exemplos) que o agente carrega quando a tarefa pede.
As de design ensinam o modelo a fugir do visual genérico de IA (o famoso *AI slop*: gradiente roxo, Inter, cards iguais).

| Repositório | O que traz | Quando usar |
|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills): skill `frontend-design` | A skill oficial de design da Anthropic, a mais popular da lista. Direção estética ousada, tipografia, cor, movimento. | Ponto de partida para qualquer interface. |
| [Koomook/claude-frontend-skills](https://github.com/Koomook/claude-frontend-skills) | Plugin focado em evitar a estética genérica: temas de cor, tipografia, animações escalonadas no carregamento, texturas de fundo. | Landing pages e telas de impacto. |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Regras objetivas e mensuráveis de layout, tipografia, espaçamento e movimento ("design taste"). Instalação: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` | Quando o resultado "funciona mas está feio". |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `web-design-guidelines` (revisão de UI contra boas práticas) e skills de React Native. | Revisão/auditoria de interfaces prontas. |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | Skills de UI e motion do autor do Sonner e do Vaul. | Microinterações e animações refinadas. |
| [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) | Pacote de skills de design de interface. | Sistemas de design e consistência. |
| [jiji262/claude-design-skill](https://github.com/jiji262/claude-design-skill) | Skill portátil que transforma o agente em designer de artefatos HTML (decks, landing pages, protótipos, animações). | Protótipos rápidos em HTML. |
| [wilwaldon/Claude-Code-Frontend-Design-Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit) | **Lista curada**: skills, plugins, servidores MCP e truques de `CLAUDE.md` para frontends melhores, incluindo cerca de 23 skills das grandes bibliotecas de animação (GSAP, Framer Motion…). | Para descobrir mais coisas. Comece por aqui. |

> Outras citadas com frequência no X, mas que **não conferi nesta pesquisa**: `ui-ux-pro-max-skill` e o MCP
> "Magic" do 21st.dev (gera componentes a partir de prompt). Avalie antes de instalar.

**Como instalar uma skill no Claude Code:** copie a pasta da skill para `.claude/skills/<nome>/` (no projeto)
ou `~/.claude/skills/<nome>/` (global), ou use `/plugin marketplace add <dono>/<repo>` quando o repositório for um marketplace de plugins.
Este repositório já traz uma skill própria em [`.claude/skills/agent-lab-ui`](../.claude/skills/agent-lab-ui/SKILL.md)
com o sistema visual do Agent Lab.

## 2. Bibliotecas de componentes animados (React)

As mais citadas em 2026. Quase todas seguem o modelo do *shadcn/ui*: você **copia o código** do componente
para o seu projeto em vez de instalar um pacote, então dá pra ler e adaptar tudo.

| Biblioteca | Destaque | Observação |
|---|---|---|
| [React Bits](https://reactbits.dev) ([DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)) | A mais popular. Mais de 110 componentes: textos animados, fundos (Aurora, Particles…), cursores, cards. | Muitos componentes não dependem do Framer Motion. |
| [Magic UI](https://magicui.design) ([magicuidesign/magicui](https://github.com/magicuidesign/magicui)) | Visual polido para páginas de marketing: Border Beam, Number Ticker, Animated Beam, Shiny Text. | Usa Motion na maioria dos componentes. |
| [Aceternity UI](https://ui.aceternity.com) | Efeitos mais chamativos para *hero sections*: Spotlight, Background Beams, 3D cards. | O guia de comparação é escrito pelo próprio fornecedor. |
| [Motion Primitives](https://motion-primitives.com) | Blocos de construção de baixo nível feitos com Motion, para compor as suas animações. | Ótimo para aprender motion design. |
| [Animate UI](https://animate-ui.com) | Microinterações para a interface inteira (botões, tabs, toggles). | Bom para dashboards. |
| Cult UI, Kokonut UI, Eldora UI, Animata | Alternativas com estilos próprios. | Vale olhar como inspiração. |
| [21st.dev](https://21st.dev) | Registro comunitário de componentes (um "npm de componentes de UI"). | Pesquise por efeito, ex.: "beam". |

**Recomendação comum:** uma base de *shadcn/ui* mais uma ou duas bibliotecas de motion para efeitos pontuais.
Evite misturar várias bibliotecas de efeito na mesma tela.

## 3. O que foi aplicado no Agent Lab

Em vez de instalar as bibliotecas, os efeitos foram **reimplementados** em
[`web/src/components/effects.tsx`](../web/src/components/effects.tsx) e no CSS, com `motion`. Assim dá pra estudar o código de cada um:

| Efeito no Agent Lab | Inspiração | Onde aparece |
|---|---|---|
| `Aurora`: manchas de gradiente borradas flutuando + grade de laboratório | React Bits (Aurora) | Fundo de todas as páginas |
| `SpotlightCard`: holofote que segue o mouse | Aceternity / React Bits | Cards de agentes, prompts, métricas |
| `NumberTicker`: números que "contam" até o valor | Magic UI | Visão geral |
| `.beam`: borda com feixe de luz girando | Magic UI (Border Beam) | Iteração ativa, ferramenta executando, resposta final |
| `BlurText`: palavras surgindo com desfoque | React Bits (Blur Text) | Título da visão geral |
| `.shimmer-text`: brilho passando pelo texto | Magic UI (Animated Shiny Text) | "pensando…" |
| `BeamEdge`: partículas correndo pelas arestas do grafo | Magic UI (Animated Beam) | Grafo ao vivo do playground |
| `LoopDiagram`: o loop agêntico animado | — | Visão geral e Aprender |

Tipografia: **Geist** (interface), **Geist Mono** (dados/código) e **Instrument Serif** itálico (destaques editoriais).

## Fontes

- [Claude-Code-Frontend-Design-Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit)
- [Koomook/claude-frontend-skills](https://github.com/Koomook/claude-frontend-skills)
- [jiji262/claude-design-skill](https://github.com/jiji262/claude-design-skill)
- [Top 8 Claude Skills for UI/UX Engineers (Snyk)](https://snyk.io/articles/top-claude-skills-ui-ux-engineers/)
- [9 Best UI Skills for Claude Code in 2026 (Medium)](https://medium.com/@hii_mohit/9-best-ui-skills-for-claude-code-in-2026-i-tested-them-all-58fe42809376)
- [Claude Design Skills for Frontend & UI: 206 graded](https://agentskillshub.top/best/ai-design/)
- [Magic UI Alternatives: 8 Animated React Libraries (2026)](https://designrevision.com/alternatives/magic-ui)
- [React Bits vs Aceternity vs Magic UI 2026 (PkgPulse)](https://www.pkgpulse.com/guides/react-bits-vs-aceternity-magic-ui-2026)
- [Best React UI components 2026 (Aceternity)](https://ui.aceternity.com/guides/best-react-ui-components-2026)
- [5 best animated component libraries for React and Next.js in 2026 (DEV)](https://dev.to/hiteshbhardwaj/5-best-animated-component-libraries-for-react-and-nextjs-in-2026-1382)
