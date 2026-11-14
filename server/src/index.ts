import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { handle, initCore, registerStdioTransport, subscribe, type StorageAdapter } from "../../core/index.js";

/**
 * Hospedeiro Node do Agent Lab. Toda a lógica mora em core/ (que também roda
 * no navegador); aqui só ficam as coisas que exigem Node:
 *  - salvar os dados num arquivo JSON;
 *  - iniciar servidores MCP como processos locais (stdio);
 *  - servir a API por HTTP + SSE.
 */

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const fileStorage: StorageAdapter = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
      return null;
    }
  },
  save(db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  },
};

registerStdioTransport((cfg, log) => {
  const t = new StdioClientTransport({
    command: cfg.command!,
    args: cfg.args ?? [],
    env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
    stderr: "pipe",
  });
  t.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) log(`stderr: ${line}`);
  });
  return t;
});

initCore({
  runtime: "server",
  storage: fileStorage,
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api", async (req, res) => {
  const apiPath = `/api${req.path}`;

  // Streams ao vivo via Server-Sent Events.
  if (req.method === "GET") {
    let send: ((data: unknown) => void) | null = null;
    const unsubscribe = subscribe(apiPath, (data) => send?.(data));
    if (unsubscribe) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(": conectado\n\n"); // libera os cabeçalhos já (o EventSource só dispara onopen ao receber algo)
      send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }
  }

  const result = await handle({
    method: req.method,
    path: apiPath,
    query: Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)])),
    body: req.body,
  });
  if (apiPath === "/api/audit/export") res.setHeader("content-disposition", `attachment; filename="auditoria-${Date.now()}.json"`);
  res.status(result.status).json(result.body);
});

// Build de produção da interface (npm run build).
const webDist = path.resolve(process.cwd(), "../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`\n  🧪 Agent Lab API em http://localhost:${PORT}\n`);
});
