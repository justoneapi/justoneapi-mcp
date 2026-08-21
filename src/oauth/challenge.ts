import {
  MCP_OAUTH_SCOPES,
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  type McpOAuthScope,
} from "./constants.js";

export const MCP_PROTECTED_RESOURCE_METADATA_URL = `https://mcp.justoneapi.com${MCP_PROTECTED_RESOURCE_METADATA_PATH}`;

type BearerChallengeOptions = {
  error?: "invalid_token" | "insufficient_scope";
  description?: string;
  scopes?: readonly McpOAuthScope[];
};

export function buildBearerChallenge(options: BearerChallengeOptions = {}): string {
  const scopes = options.scopes ?? MCP_OAUTH_SCOPES;
  const parts = [
    `resource_metadata="${quote(MCP_PROTECTED_RESOURCE_METADATA_URL)}"`,
    `scope="${quote(scopes.join(" "))}"`,
  ];
  if (options.error) parts.push(`error="${quote(options.error)}"`);
  if (options.description) {
    parts.push(`error_description="${quote(options.description)}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

function quote(value: string): string {
  return value.replace(/["\\]/g, (character) => `\\${character}`);
}
