/**
 * Executa o servidor MCP "laboratorio" como um processo separado, falando
 * JSON-RPC por stdin/stdout. É assim que a maioria dos servidores MCP roda.
 *
 *   node --import tsx mcp-servers/laboratorio/index.ts
 *
 * As ferramentas estão em core/mcp/lab-server.ts.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLabServer } from "../../core/mcp/lab-server.js";

await createLabServer().connect(new StdioServerTransport());
console.error("[laboratorio] servidor MCP pronto (stdio)"); // stderr: aparece nos logs do Agent Lab
