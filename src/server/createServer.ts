import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { runTool } from "../common/toolResult.js";
import { callEndpoint, CallEndpointInput } from "../tools/callEndpoint.js";
import { getEndpointSchema, GetEndpointSchemaInput } from "../tools/getEndpointSchema.js";
import { listPlatforms } from "../tools/listPlatforms.js";
import { refreshCatalog, RefreshCatalogInput } from "../tools/refreshCatalog.js";
import { searchEndpoints, SearchEndpointsInput } from "../tools/searchEndpoints.js";
import { version } from "../version.js";

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

  server.registerTool(
    "search_endpoints",
    {
      description:
        "Find JustOneAPI endpoint candidates from natural language. Returns endpoint_id candidates; call get_endpoint_schema next.",
      inputSchema: SearchEndpointsInput.shape,
    },
    async (input) => runTool(() => searchEndpoints(SearchEndpointsInput.parse(input), ctx))
  );

  server.registerTool(
    "get_endpoint_schema",
    {
      description:
        "Get the full schema and parameter contract for an endpoint_id returned by search_endpoints.",
      inputSchema: GetEndpointSchemaInput.shape,
    },
    async (input) => runTool(() => getEndpointSchema(GetEndpointSchemaInput.parse(input), ctx))
  );

  server.registerTool(
    "call_endpoint",
    {
      description:
        "Validate params and call a JustOneAPI endpoint by endpoint_id. Params should use snake_case names from get_endpoint_schema.",
      inputSchema: CallEndpointInput.shape,
    },
    async (input) => runTool(() => callEndpoint(CallEndpointInput.parse(input), ctx))
  );

  server.registerTool(
    "list_platforms",
    {
      description: "List supported JustOneAPI platforms and endpoint counts.",
      inputSchema: z.object({}).shape,
    },
    async () => runTool(() => listPlatforms(ctx))
  );

  server.registerTool(
    "refresh_catalog",
    {
      description: "Admin-only. Refresh the endpoint catalog from JustOneAPI OpenAPI documents.",
      inputSchema: RefreshCatalogInput.shape,
    },
    async (input) => runTool(() => refreshCatalog(RefreshCatalogInput.parse(input), ctx))
  );

  return server;
}
