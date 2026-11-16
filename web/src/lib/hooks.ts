import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeStream } from "./api";

/** Busca um recurso e expõe `reload` para atualizar depois de mutações. */
export function useResource<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api.get<T>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/**
 * Assina um endpoint SSE e chama `onMessage` para cada evento.
 * Quem assina informa o tipo dos eventos daquele endpoint; eles vêm do próprio núcleo, no mesmo processo.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- o tipo nomeia o fluxo assinado
export function useEventStream<T>(url: string | null, onMessage: (data: T) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!url) return;
    return subscribeStream(
      url,
      (data) => handler.current(data as T) /* os eventos do endpoint seguem o tipo informado por quem assina */,
      setConnected,
    );
  }, [url]);

  return connected;
}

export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
