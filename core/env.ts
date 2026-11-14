/** Informações do hospedeiro, preenchidas na inicialização. */
export const hostEnv: {
  runtime: "server" | "browser";
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
} = { runtime: "browser" };
