import { createContext, useContext } from "react";

/**
 * Abre uma execução delegada no painel lateral. Sem provedor (fora do Playground), os cartões de delegação
 * mostram só o link para a página da execução.
 */
export const OpenRunContext = createContext<((runId: string) => void) | null>(null);
export const useOpenRun = () => useContext(OpenRunContext);
