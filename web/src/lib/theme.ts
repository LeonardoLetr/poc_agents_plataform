import { useEffect, useState } from "react";

/**
 * Tema da interface: "claro" (papel bege) ou "escuro" (grafite quente).
 * Sem escolha salva, segue a preferência do sistema operacional.
 */
export type Theme = "claro" | "escuro";

const KEY = "agentlab.tema";
const META: Record<Theme, string> = { claro: "#f7f5ef", escuro: "#262624" };
const media = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "claro" || v === "escuro" ? v : null;
  } catch {
    return null;
  }
}

export function resolveTheme(): Theme {
  return stored() ?? (media()?.matches ? "escuro" : "claro");
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "escuro") root.dataset.theme = "escuro";
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[theme]);
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* armazenamento indisponível: vale só nesta visita */
  }
  applyTheme(theme);
}

/** Aplica o tema antes do primeiro render. Aceita ?tema=claro|escuro no endereço. */
export function initTheme() {
  const fromUrl = new URLSearchParams(location.search).get("tema");
  if (fromUrl === "claro" || fromUrl === "escuro") saveTheme(fromUrl);
  else applyTheme(resolveTheme());
  // Acompanha mudanças do sistema enquanto o usuário não escolheu um tema.
  media()?.addEventListener?.("change", () => {
    if (!stored()) applyTheme(resolveTheme());
  });
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(resolveTheme);
  useEffect(() => {
    const sync = () => setTheme(resolveTheme());
    media()?.addEventListener?.("change", sync);
    return () => media()?.removeEventListener?.("change", sync);
  }, []);
  const toggle = () => {
    const next: Theme = theme === "escuro" ? "claro" : "escuro";
    saveTheme(next);
    setTheme(next);
  };
  return { theme, toggle };
}
