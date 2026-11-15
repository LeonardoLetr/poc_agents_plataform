import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import "./index.css";
import App from "./App";

// Tema visual: ?tema=bege | ?tema=escuro | ?tema=claro (padrão). A escolha fica salva no navegador.
const THEMES = ["claro", "bege", "escuro"];
try {
  const fromUrl = new URLSearchParams(location.search).get("tema");
  if (fromUrl && THEMES.includes(fromUrl)) localStorage.setItem("agentlab.tema", fromUrl);
  const theme = localStorage.getItem("agentlab.tema");
  if (theme && theme !== "claro") document.documentElement.dataset.theme = theme;
} catch {
  /* armazenamento indisponível: usa o tema padrão */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
