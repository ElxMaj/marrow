import { type Marrow } from "@marrowhq/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createTools } from "./tools.js";

/** Build the MCP server: register the read and shaped-write tools over core
 *  using the official SDK. The server holds no product logic. */
export function createServer(core: Marrow): Server {
  const tools = createTools(core);
  const server = new Server({ name: "marrow", version: "0.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(request.params.arguments ?? {});
      // pretty-printed so the agent reads status and provenance at a glance,
      // not a wall of minified JSON.
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  });

  return server;
}

/** Run the server over stdio, the transport an agent host connects to. */
export async function runStdio(core: Marrow): Promise<void> {
  await createServer(core).connect(new StdioServerTransport());
}
