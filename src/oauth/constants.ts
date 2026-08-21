export const MCP_OAUTH_ISSUER = "https://auth.justoneapi.com";
export const MCP_RESOURCE = "https://mcp.justoneapi.com/mcp";
export const MCP_DELEGATION_RESOURCE = "https://api.justoneapi.com";
export const MCP_WORKER_CLIENT_ID = "justoneapi-mcp-worker";

export const MCP_TOKEN_ENDPOINT = `${MCP_OAUTH_ISSUER}/oauth2/token`;
export const MCP_INTROSPECTION_ENDPOINT = `${MCP_OAUTH_ISSUER}/oauth2/introspect`;

export const MCP_ROUTE = "/mcp";
export const MCP_PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
export const MCP_PROTECTED_RESOURCE_METADATA_ROOT_PATH = "/.well-known/oauth-protected-resource";
export const MCP_WORKER_JWKS_PATH = "/.well-known/jwks.json";

export const MCP_OAUTH_SCOPES = ["mcp:catalog:read", "mcp:api:call", "mcp:account:read"] as const;

export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

export const OAUTH_ACCESS_TOKEN_PREFIX = "joa_at_v1_";
export const OAUTH_DELEGATION_TOKEN_PREFIX = "joa_dt_v1_";
