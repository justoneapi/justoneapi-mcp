import { McpServer } from "@modelcontextprotocol/server";
import { RuntimeContext } from "../common/runtime.js";
import { runTool } from "../common/toolResult.js";
import { version } from "../version.js";
import { createCanonicalToolDescriptors } from "./toolDescriptors.js";
import { toolDefinitionsFor } from "./toolRegistry.js";

const INSTRUCTIONS = `JustOneAPI MCP exposes JustOneAPI endpoints through a small discovery workflow.

Use this order unless the endpoint_id is already known:
1. search_endpoints: find endpoint candidates from the user's natural language request.
2. get_endpoint_schema: inspect required params and enum/default values.
3. call_endpoint: call the endpoint with snake_case params.

Do not guess required params. If search confidence is low, ask the user to clarify platform or data type.
For paginated results, follow next_step.`;

export function createJustOneMcpServer(ctx: RuntimeContext): McpServer {
  const server = new McpServer({
    name: "justoneapi-mcp",
    version,
    description: INSTRUCTIONS,
  });

  for (const definition of toolDefinitionsFor(ctx)) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        annotations: definition.annotations,
      },
      async (input) => runTool(() => definition.invoke(input, ctx))
    );
  }

  const descriptors = createCanonicalToolDescriptors(ctx);
  server.server.setRequestHandler("tools/list", () => ({ tools: descriptors }));

  return server;
}
