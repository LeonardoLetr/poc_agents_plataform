/** Configuração do ambiente de execução, preenchida na inicialização. */
export const hostEnv: {
  /** Multiplicador dos atrasos simulados da LLM demo (0 = sem atraso, usado nos testes). */
  demoDelayScale: number;
} = { demoDelayScale: 1 };
