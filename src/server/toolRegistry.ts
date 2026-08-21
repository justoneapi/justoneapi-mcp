import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { RuntimeContext } from "../common/runtime.js";
import type { McpOAuthScope } from "../oauth/constants.js";
import {
  GetAccountBalanceInput,
  GetUsageSummaryInput,
  getAccountBalance,
  getUsageSummary,
} from "../tools/account.js";
import { callEndpoint, CallEndpointInput } from "../tools/callEndpoint.js";
import { getEndpointSchema, GetEndpointSchemaInput } from "../tools/getEndpointSchema.js";
import { listPlatforms } from "../tools/listPlatforms.js";
import { refreshCatalog, RefreshCatalogInput } from "../tools/refreshCatalog.js";
import { searchEndpoints, SearchEndpointsInput } from "../tools/searchEndpoints.js";

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations;
  requiredScopes: readonly McpOAuthScope[];
  remote: boolean;
  invoke(input: unknown, ctx: RuntimeContext): Promise<unknown> | unknown;
};

const ObjectToolOutput = z.looseObject({});

export const toolDefinitions: readonly ToolDefinition[] = [
  {
    name: "search_endpoints",
    title: "Search endpoints",
    description:
      "Find JustOneAPI endpoint candidates from natural language. Returns endpoint_id candidates; call get_endpoint_schema next.",
    inputSchema: SearchEndpointsInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScopes: ["mcp:catalog:read"],
    remote: true,
    invoke: (input, ctx) => searchEndpoints(SearchEndpointsInput.parse(input), ctx),
  },
  {
    name: "get_endpoint_schema",
    title: "Get endpoint schema",
    description:
      "Get the full schema and parameter contract for an endpoint_id returned by search_endpoints.",
    inputSchema: GetEndpointSchemaInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScopes: ["mcp:catalog:read"],
    remote: true,
    invoke: (input, ctx) => getEndpointSchema(GetEndpointSchemaInput.parse(input), ctx),
  },
  {
    name: "call_endpoint",
    title: "Call endpoint (may incur charges)",
    description:
      "Validate params and make one JustOneAPI endpoint call by endpoint_id. The call may incur charges under the bound API Token's current pricing and budget. Params should use snake_case names from get_endpoint_schema.",
    inputSchema: CallEndpointInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    requiredScopes: ["mcp:api:call"],
    remote: true,
    invoke: (input, ctx) => callEndpoint(CallEndpointInput.parse(input), ctx),
  },
  {
    name: "get_account_balance",
    title: "Get account balance",
    description:
      "Get the current JustOneAPI token's available balance and currency. Use this when the user asks about account balance, remaining balance, or whether the token can continue calling APIs.",
    inputSchema: GetAccountBalanceInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    requiredScopes: ["mcp:account:read"],
    remote: true,
    invoke: (input, ctx) => getAccountBalance(GetAccountBalanceInput.parse(input), ctx),
  },
  {
    name: "get_usage_summary",
    title: "Get usage summary",
    description:
      "Get the current JustOneAPI token's API usage and spending summary, including recent call trends and spending trends.",
    inputSchema: GetUsageSummaryInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    requiredScopes: ["mcp:account:read"],
    remote: true,
    invoke: (input, ctx) => getUsageSummary(GetUsageSummaryInput.parse(input), ctx),
  },
  {
    name: "list_platforms",
    title: "List platforms",
    description: "List supported JustOneAPI platforms and endpoint counts.",
    inputSchema: z.object({}),
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScopes: ["mcp:catalog:read"],
    remote: true,
    invoke: (_input, ctx) => listPlatforms(ctx),
  },
  {
    name: "refresh_catalog",
    title: "Refresh catalog",
    description: "Admin-only. Refresh the endpoint catalog from JustOneAPI OpenAPI documents.",
    inputSchema: RefreshCatalogInput,
    outputSchema: ObjectToolOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    requiredScopes: [],
    remote: false,
    invoke: (input, ctx) => refreshCatalog(RefreshCatalogInput.parse(input), ctx),
  },
];

export function toolDefinitionsFor(ctx: RuntimeContext): readonly ToolDefinition[] {
  return ctx.transport === "worker"
    ? toolDefinitions.filter((definition) => definition.remote)
    : toolDefinitions;
}
