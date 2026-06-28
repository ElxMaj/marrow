// @marrowhq/mcp-server is the agent's way in: the official MCP SDK over core.
// It holds no product logic; it maps tools to core calls. See PR-08.
export { createTools, type ToolDef } from "./tools.js";
export { createServer, runStdio } from "./server.js";
