import { z } from "zod";
import { cancelRun, continueRun, resolveApproval, startRun } from "../agent/runner.js";
import { db } from "../store.js";
import { errorMessage } from "../util.js";
import { defineRoutes, HttpError, notFound } from "./http.js";

export const runRoutes = defineRoutes((route) => {
  route("GET", "/api/runs", (_p, req) =>
    db.runs
      .filter((r) => !req.query.agentId || r.agentId === req.query.agentId)
      .slice(-50)
      .reverse()
      .map(({ events, messages, ...rest }) => ({ ...rest, eventCount: events.length, messageCount: messages.length })),
  );

  route(
    "POST",
    "/api/runs",
    (_p, req) => {
      const body = z.object({ agentId: z.string(), input: z.string().min(1) }).parse(req.body);
      const agent = db.agents.find((a) => a.id === body.agentId) ?? notFound("Agente");
      try {
        return { id: startRun(agent, body.input).id };
      } catch (err) {
        throw new HttpError(400, errorMessage(err));
      }
    },
    { created: true },
  );

  route("GET", "/api/runs/:id", ({ id }) => db.runs.find((r) => r.id === id) ?? notFound("Execução"));

  route("POST", "/api/runs/:id/messages", ({ id }, req) => {
    const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
    try {
      continueRun(id, text);
      return { ok: true };
    } catch (err) {
      throw new HttpError(400, errorMessage(err));
    }
  });

  route("POST", "/api/runs/:id/cancel", ({ id }) => ({ ok: cancelRun(id) }));

  route("POST", "/api/runs/:id/approve", ({ id }, req) => {
    const { toolUseId, approved } = z.object({ toolUseId: z.string(), approved: z.boolean() }).parse(req.body);
    return { ok: resolveApproval(id, toolUseId, approved) };
  });
});
