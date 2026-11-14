import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

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
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/** Assina um endpoint SSE e chama `onMessage` para cada evento. */
export function useEventStream<T>(url: string | null, onMessage: (data: T) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        handler.current(JSON.parse(e.data) as T);
      } catch {
        /* ignora eventos malformados */
      }
    };
    return () => {
      es.close();
      setConnected(false);
    };
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
