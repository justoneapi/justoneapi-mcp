import { MCP_OAUTH_SCOPES } from "../../oauth/constants.js";
import type { WorkerOAuthConfig } from "./config.js";

export function protectedResourceMetadata(config: WorkerOAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "JustOneAPI MCP",
    resource_documentation: "https://github.com/justoneapi/justoneapi-mcp",
  };
}
