import {
  MCP_DELEGATION_RESOURCE,
  MCP_INTROSPECTION_ENDPOINT,
  MCP_OAUTH_ISSUER,
  MCP_RESOURCE,
  MCP_TOKEN_ENDPOINT,
  MCP_WORKER_CLIENT_ID,
} from "../../oauth/constants.js";

export type WorkerOAuthMode = "off" | "dual";

export type WorkerOAuthConfig = {
  mode: WorkerOAuthMode;
  issuer: string;
  resource: string;
  delegationResource: string;
  clientId: string;
  tokenEndpoint: string;
  introspectionEndpoint: string;
  activeKid?: string;
  privateJwks?: string;
  introspectionCacheTtlMs: number;
  introspectionCacheMaxEntries: number;
  authorizationServerTimeoutMs: number;
  allowedOrigins: "*" | ReadonlySet<string>;
};

type OAuthEnv = {
  JUSTONEAPI_OAUTH_MODE?: string;
  JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID?: string;
  JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS?: string;
  JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_TTL_MS?: string;
  JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_MAX_ENTRIES?: string;
  JUSTONEAPI_OAUTH_AS_TIMEOUT_MS?: string;
  JUSTONEAPI_MCP_ALLOWED_ORIGINS?: string;
};

export function loadWorkerOAuthConfig(env: OAuthEnv): WorkerOAuthConfig {
  const rawMode = env.JUSTONEAPI_OAUTH_MODE?.trim().toLowerCase() || "off";
  if (rawMode !== "off" && rawMode !== "dual") {
    throw new TypeError("JUSTONEAPI_OAUTH_MODE must be off or dual");
  }

  return {
    mode: rawMode,
    issuer: MCP_OAUTH_ISSUER,
    resource: MCP_RESOURCE,
    delegationResource: MCP_DELEGATION_RESOURCE,
    clientId: MCP_WORKER_CLIENT_ID,
    tokenEndpoint: MCP_TOKEN_ENDPOINT,
    introspectionEndpoint: MCP_INTROSPECTION_ENDPOINT,
    activeKid: optionalNonEmpty(env.JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID),
    privateJwks: optionalNonEmpty(env.JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS),
    introspectionCacheTtlMs: integerInRange(
      env.JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_TTL_MS,
      60_000,
      0,
      60_000
    ),
    introspectionCacheMaxEntries: integerInRange(
      env.JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_MAX_ENTRIES,
      2_048,
      1,
      10_000
    ),
    authorizationServerTimeoutMs: integerInRange(
      env.JUSTONEAPI_OAUTH_AS_TIMEOUT_MS,
      5_000,
      500,
      30_000
    ),
    allowedOrigins: parseAllowedOrigins(env.JUSTONEAPI_MCP_ALLOWED_ORIGINS),
  };
}

function canonicalHttpsUrl(name: string, value: string, originOnly = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== "/")
  ) {
    throw new TypeError(`${name} must be a canonical HTTPS URL`);
  }
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function integerInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`OAuth numeric configuration must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseAllowedOrigins(raw: string | undefined): "*" | ReadonlySet<string> {
  if (!raw?.trim() || raw.trim() === "*") return "*";
  const origins = new Set(
    raw
      .split(",")
      .map((value) => canonicalHttpsUrl("JUSTONEAPI_MCP_ALLOWED_ORIGINS", value.trim(), true))
  );
  if (!origins.size) throw new TypeError("JUSTONEAPI_MCP_ALLOWED_ORIGINS is empty");
  return origins;
}
