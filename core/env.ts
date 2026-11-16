/** Informações do hospedeiro, preenchidas na inicialização. */
export const hostEnv: {
  runtime: "server" | "browser";
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
  /** Multiplicador dos atrasos simulados da LLM demo (0 = sem atraso, usado nos testes). */
  demoDelayScale: number;
} = { runtime: "browser", demoDelayScale: 1 };
