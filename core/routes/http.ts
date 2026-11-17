/** Peças comuns das rotas do núcleo: formato de requisição e resposta, erros HTTP e a definição de rotas. */

export type ApiRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
};
export type ApiResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string): never => {
  throw new HttpError(404, `${what} não encontrado(a)`);
};

/** Parâmetros de um caminho como "/api/runs/:id/approve" → { id: string }. */
type PathParams<P extends string> = P extends `${string}:${infer Key}/${infer Rest}`
  ? { [K in Key]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Key}`
    ? { [K in Key]: string }
    : object;

type Handler = (p: Record<string, string>, req: ApiRequest) => unknown;
type Method = "GET" | "POST" | "PUT" | "DELETE";

export type Route = {
  method: Method;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** Responde 201: a rota cria um recurso. */
  created: boolean;
};

type DefineRoute = <P extends string>(
  method: Method,
  path: P,
  handler: (p: PathParams<P>, req: ApiRequest) => unknown,
  opts?: { created?: boolean },
) => void;

/** Lista de rotas de um recurso. */
export function defineRoutes(define: (route: DefineRoute) => void): Route[] {
  const routes: Route[] = [];
  define((method, path, handler, opts) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
    // Seguro: o despacho só chama o handler quando o padrão casou, com um valor para cada parâmetro do caminho.
    routes.push({ method, pattern, keys, handler: handler as Handler, created: opts?.created ?? false });
  });
  return routes;
}
