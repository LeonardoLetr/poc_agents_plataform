# Referências de design: bibliotecas de animação e skills de interface

Levantamento de referências (novembro de 2026) que embasaram o sistema visual do Agent Lab. Os indicadores de
popularidade vêm de agregadores públicos e devem ser conferidos nos respectivos repositórios antes de qualquer adoção.

## 1. Skills de design para agentes de código

Uma *skill* é um diretório com um arquivo `SKILL.md` (instruções e exemplos) carregado pelo agente quando a tarefa é
pertinente. As skills de design definem diretrizes de tipografia, cor, layout e movimento para orientar a geração de
interfaces.

| Repositório | Conteúdo | Aplicação |
|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills): `frontend-design` | Skill de referência da Anthropic: direção estética, tipografia, cor e movimento. | Base para qualquer interface. |
| [Koomook/claude-frontend-skills](https://github.com/Koomook/claude-frontend-skills) | Temas de cor, tipografia, animações de carregamento e texturas de fundo. | Páginas de apresentação. |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Regras mensuráveis de layout, tipografia, espaçamento e movimento. | Refinamento de interfaces existentes. |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `web-design-guidelines` (revisão de UI com base em boas práticas) e skills de React Native. | Revisão e auditoria. |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | Diretrizes de UI e microinterações. | Animações de interface. |
| [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) | Pacote de skills de design de interface. | Sistemas de design. |
| [jiji262/claude-design-skill](https://github.com/jiji262/claude-design-skill) | Geração de artefatos HTML: apresentações, protótipos e animações. | Prototipação. |
| [wilwaldon/Claude-Code-Frontend-Design-Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit) | Lista curada de skills, plugins e servidores MCP, incluindo skills para GSAP e Motion. | Descoberta de novas ferramentas. |

**Instalação no Claude Code:** copiar o diretório da skill para `.claude/skills/<nome>/` (escopo do projeto) ou
`~/.claude/skills/<nome>/` (escopo global), ou usar `/plugin marketplace add <dono>/<repo>` quando o repositório for um
marketplace de plugins. O guia visual deste projeto está em [`.claude/skills/agent-lab-ui`](../.claude/skills/agent-lab-ui/SKILL.md).

## 2. Bibliotecas de componentes animados (React)

A maioria segue o modelo do *shadcn/ui*: o código do componente é copiado para o projeto, em vez de instalado como
dependência, o que permite leitura e adaptação completas.

| Biblioteca | Destaques | Observação |
|---|---|---|
| [React Bits](https://reactbits.dev) ([DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)) | Mais de 110 componentes: textos animados, fundos, cursores e cartões. | Parte dos componentes não depende do Motion. |
| [Magic UI](https://magicui.design) ([magicuidesign/magicui](https://github.com/magicuidesign/magicui)) | Border Beam, Number Ticker, Animated Beam, Shiny Text. | Baseada em Motion. |
| [Aceternity UI](https://ui.aceternity.com) | Efeitos para seções de destaque: Spotlight, Background Beams, cartões 3D. | Voltada a páginas de marketing. |
| [Motion Primitives](https://motion-primitives.com) | Primitivos de baixo nível para composição de animações. | Útil como referência didática. |
| [Animate UI](https://animate-ui.com) | Microinterações para botões, abas e alternadores. | Adequada a dashboards. |
| Cult UI, Kokonut UI, Eldora UI, Animata | Coleções com identidades visuais próprias. | Referência de estilo. |
| [21st.dev](https://21st.dev) | Registro comunitário de componentes de UI. | Busca por tipo de efeito. |

Prática recomendada: uma base de componentes (como *shadcn/ui*) complementada por uma ou duas bibliotecas de
animação para efeitos pontuais.

## 3. Aplicação no Agent Lab

Os efeitos utilizados foram implementados diretamente com [`motion`](https://motion.dev), sem dependência das
bibliotecas acima. O sistema visual adotado está documentado em
[`.claude/skills/agent-lab-ui`](../.claude/skills/agent-lab-ui/SKILL.md) e os estudos de layout em
[`docs/design-concepts`](design-concepts/README.md). Em resumo:

- fundo em tom papel, cartões brancos com borda de 1px e uma única cor de destaque;
- Source Serif 4 em títulos, Geist na interface e Geist Mono em dados;
- cor reservada para indicação de estado e animação restrita a sinais de atividade (execução do agente, fluxo no grafo).

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
