import { z } from "zod";
import { audit } from "../audit.js";
import { db, persist } from "../store.js";
import { type PromptTemplate } from "../types.js";
import { now, uid } from "../util.js";
import { defineRoutes, notFound } from "./http.js";

const PromptInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  content: z.string().min(1),
  category: z.enum(["system", "task"]).default("system"),
  agentIds: z.array(z.string()).default([]),
});

export const promptRoutes = defineRoutes((route) => {
  route("GET", "/api/prompts", () => db.prompts);

  route(
    "POST",
    "/api/prompts",
    (_p, req) => {
      const prompt: PromptTemplate = { id: uid("prm"), ...PromptInput.parse(req.body), createdAt: now() };
      db.prompts.push(prompt);
      persist();
      audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" criado` });
      return prompt;
    },
    { created: true },
  );

  route("PUT", "/api/prompts/:id", ({ id }, req) => {
    const prompt = db.prompts.find((p) => p.id === id) ?? notFound("Prompt");
    Object.assign(prompt, PromptInput.parse(req.body));
    persist();
    audit({ type: "config.changed", actor: "user", summary: `Prompt "${prompt.name}" atualizado` });
    return prompt;
  });

  route("DELETE", "/api/prompts/:id", ({ id }) => {
    const removed = db.prompts.find((p) => p.id === id) ?? notFound("Prompt");
    db.prompts.splice(db.prompts.indexOf(removed), 1);
    persist();
    audit({ type: "config.changed", actor: "user", summary: `Prompt "${removed.name}" removido` });
    return { ok: true };
  });
});
