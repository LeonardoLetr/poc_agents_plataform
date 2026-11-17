import { allMcpTools } from "../mcp/manager.js";
import { db } from "../store.js";
import { builtinTools } from "../tools/builtin.js";
import { SERVER_TOOLS } from "../tools/server.js";
import { isRemoteMcp } from "../mcp/remote.js";
import { agentToolDefinition } from "../agent/delegation.js";
import { defineRoutes } from "./http.js";

export const toolRoutes = defineRoutes((route) => {
  route("GET", "/api/tools", () => {
    const builtin = Object.values(builtinTools).map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      inputSchema: t.definition.input_schema,
      source: "builtin" as const,
      category: t.category,
    }));
    const mcp = allMcpTools(db.mcpServers).map((t) => ({
      name: t.definition.name,
      description: t.tool.description,
      inputSchema: t.tool.inputSchema,
      source: "mcp" as const,
      server: t.server.name,
      category: "mcp",
    }));
    const server = Object.values(SERVER_TOOLS).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {},
      source: "server" as const,
      category: t.category,
    }));
    // Servidores MCP conectados pela Anthropic: as ferramentas só são conhecidas durante a execução.
    const remoteMcp = db.mcpServers.filter(isRemoteMcp).flatMap((s) => [
      {
        name: `mcp__${s.name}__*`,
        description: "Ferramentas descobertas e executadas pela API da Anthropic durante a execução (apenas LLMs Anthropic).",
        inputSchema: {},
        source: "mcp" as const,
        server: s.name,
        category: "mcp",
        viaAnthropic: true,
      },
      // Ferramentas já conhecidas (descobertas ou usadas) podem ser habilitadas uma a uma.
      ...(s.knownTools ?? []).map((t) => ({
        name: `mcp__${s.name}__${t.name}`,
        description: t.description ?? "",
        inputSchema: {},
        source: "mcp" as const,
        server: s.name,
        category: "mcp",
        viaAnthropic: true,
      })),
    ]);
    // Outros agentes como ferramentas (multiagente). O editor oculta o próprio agente.
    const agents = db.agents.map((a) => {
      const def = agentToolDefinition(a);
      return {
        name: def.name,
        description: def.description,
        inputSchema: def.input_schema,
        source: "agent" as const,
        category: "agente",
        agentId: a.id,
        label: `${a.emoji} ${a.name}`,
      };
    });
    return [...builtin, ...server, ...agents, ...mcp, ...remoteMcp];
  });
});
