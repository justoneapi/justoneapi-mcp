import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { CatalogManager } from "./catalog/manager.js";
import { sha256Hex, timingSafeEqual } from "./common/auth.js";
import { stderrLogger } from "./common/logger.js";
import type { RuntimeContext, WorkerOAuthRuntimeContext } from "./common/runtime.js";
import { loadWorkerConfig } from "./config.js";
import { bundledCatalog } from "./generated/bundledCatalog.js";
import {
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  MCP_PROTECTED_RESOURCE_METADATA_ROOT_PATH,
  MCP_ROUTE,
  MCP_WORKER_JWKS_PATH,
  type McpOAuthScope,
} from "./oauth/constants.js";
import { MCP_PROTECTED_RESOURCE_METADATA_URL } from "./oauth/challenge.js";
import { createJustOneMcpServer } from "./server/createServer.js";
import { classifyCredential } from "./worker/auth/credentialClassifier.js";
import {
  corsOrigin,
  isCanonicalOAuthHost,
  isAllowedWorkerHost,
  methodNotAllowed,
  preflightResponse,
  withCors,
} from "./worker/http.js";
import { KvCatalogStore } from "./worker/kvCatalogStore.js";
import { inspectMcpRequest } from "./worker/requestScope.js";
import { loadWorkerOAuthConfig, type WorkerOAuthConfig } from "./worker/oauth/config.js";
import { OAuthInfrastructureError } from "./worker/oauth/introspection.js";
import { parsePrivateJwkSet } from "./worker/oauth/jwks.js";
import { protectedResourceMetadata } from "./worker/oauth/protectedResourceMetadata.js";
import { getWorkerOAuthServices } from "./worker/oauth/services.js";

let cachedManager: {
  key: string;
  manager: CatalogManager;
} | null = null;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    let oauthConfig: WorkerOAuthConfig;
    try {
      oauthConfig = loadWorkerOAuthConfig(env);
    } catch {
      return serviceUnavailableResponse();
    }

    if (!isAllowedWorkerHost(request)) {
      return withCors(
        Response.json({ error: "invalid_host" }, { status: 400 }),
        request,
        oauthConfig
      );
    }
    if (request.headers.has("origin") && corsOrigin(request, oauthConfig) === null) {
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    }
    if (request.method.toUpperCase() === "OPTIONS") {
      return preflightResponse(request, oauthConfig);
    }

    const url = new URL(request.url);
    const canonicalOAuthHost = isCanonicalOAuthHost(request);
    const manager = getWorkerCatalogManager(env);
    let response: Response;
    if (url.pathname === "/health") {
      response =
        request.method.toUpperCase() === "GET"
          ? await healthResponse(request, env, manager)
          : methodNotAllowed(["GET", "OPTIONS"]);
    } else if (
      url.pathname === MCP_PROTECTED_RESOURCE_METADATA_PATH ||
      url.pathname === MCP_PROTECTED_RESOURCE_METADATA_ROOT_PATH
    ) {
      response =
        oauthConfig.mode === "off" || !canonicalOAuthHost
          ? Response.json({ ok: false, error: "Not found" }, { status: 404 })
          : request.method.toUpperCase() === "GET"
            ? metadataResponse(oauthConfig)
            : methodNotAllowed(["GET", "OPTIONS"]);
    } else if (url.pathname === MCP_WORKER_JWKS_PATH) {
      response = !canonicalOAuthHost
        ? Response.json({ ok: false, error: "Not found" }, { status: 404 })
        : request.method.toUpperCase() === "GET"
          ? jwksResponse(oauthConfig)
          : methodNotAllowed(["GET", "OPTIONS"]);
    } else if (url.pathname === MCP_ROUTE) {
      response = await mcpResponse(request, env, manager, oauthConfig);
    } else {
      response = Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return withCors(response, request, oauthConfig);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const manager = getWorkerCatalogManager(env);
    ctx.waitUntil(
      manager.refresh("cron").then((result) => {
        if (!result.success) stderrLogger.warn("catalog_refresh_failed", result);
        else stderrLogger.info("catalog_refresh", result);
      })
    );
  },
} satisfies ExportedHandler<Env>;

async function mcpResponse(
  request: Request,
  env: Env,
  manager: CatalogManager,
  oauthConfig: WorkerOAuthConfig
): Promise<Response> {
  const appConfig = loadWorkerConfig(env);
  const credential = classifyCredential(request.headers);
  const oauthEnabled = oauthConfig.mode === "dual" && isCanonicalOAuthHost(request);

  if (!oauthEnabled) {
    if (credential.kind === "invalid") return hiddenCredentialError(credential);
    if (credential.kind === "oauth") {
      return Response.json(
        { error: "invalid_token" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const runtime: RuntimeContext =
      credential.kind === "legacy"
        ? {
            transport: "worker",
            oauthAdvertised: false,
            config: appConfig,
            catalogManager: manager,
            logger: stderrLogger,
            auth: {
              kind: "api-key",
              source: credential.source,
              token: credential.token,
            },
          }
        : {
            transport: "worker",
            oauthAdvertised: false,
            config: appConfig,
            catalogManager: manager,
            logger: stderrLogger,
            auth: { kind: "none" },
          };
    return await serveMcp(request, runtime);
  }

  if (credential.kind === "none") {
    return bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InvalidToken, "Bearer authentication is required"),
      { resourceMetadataUrl: MCP_PROTECTED_RESOURCE_METADATA_URL }
    );
  }
  if (credential.kind === "invalid") {
    if (credential.status === 401) return invalidTokenResponse();
    return Response.json(
      { error: "invalid_request", error_description: credential.reason },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (credential.kind === "legacy") {
    const runtime: RuntimeContext = {
      transport: "worker",
      oauthAdvertised: true,
      config: appConfig,
      catalogManager: manager,
      logger: stderrLogger,
      auth: {
        kind: "api-key",
        source: credential.source,
        token: credential.token,
      },
    };
    return await serveMcp(request, runtime);
  }

  try {
    const services = await getWorkerOAuthServices(oauthConfig);
    const authInfo = await verifyBearerToken(request.headers.get("authorization"), {
      verifier: services.verifier,
      resourceMetadataUrl: MCP_PROTECTED_RESOURCE_METADATA_URL,
    });
    const inspected = await inspectMcpRequest(request);
    if (inspected.kind === "rejected") return inspected.response;
    if (inspected.requiredScope && !authInfo.scopes.includes(inspected.requiredScope)) {
      return bearerAuthChallengeResponse(
        new OAuthError(
          OAuthErrorCode.InsufficientScope,
          `Required scope is missing: ${inspected.requiredScope}`
        ),
        {
          requiredScopes: [inspected.requiredScope],
          resourceMetadataUrl: MCP_PROTECTED_RESOURCE_METADATA_URL,
        }
      );
    }
    const exchange = services.createExchange(credential.token);
    const runtime = await createOAuthRuntime(
      appConfig,
      manager,
      credential.token,
      authInfo,
      exchange.exchange.bind(exchange)
    );
    return await serveMcp(request, runtime, inspected.parsedBody, authInfo);
  } catch (error) {
    if (error instanceof OAuthInfrastructureError || !(error instanceof OAuthError)) {
      return serviceUnavailableResponse();
    }
    return bearerAuthChallengeResponse(error, {
      resourceMetadataUrl: MCP_PROTECTED_RESOURCE_METADATA_URL,
    });
  }
}

async function createOAuthRuntime(
  config: ReturnType<typeof loadWorkerConfig>,
  manager: CatalogManager,
  accessToken: string,
  authInfo: AuthInfo,
  exchange: (scope: McpOAuthScope) => Promise<{ token: string; expiresAt: number }>
): Promise<WorkerOAuthRuntimeContext> {
  const subject = authInfo.extra?.subject;
  const connectionId = authInfo.extra?.connectionId;
  if (typeof subject !== "string" || typeof connectionId !== "string") {
    throw new OAuthInfrastructureError("authorization_server_contract_error");
  }
  return {
    transport: "worker",
    oauthAdvertised: true,
    config,
    catalogManager: manager,
    logger: stderrLogger,
    auth: {
      kind: "oauth",
      accessToken,
      accessTokenHash: await sha256Hex(accessToken),
      clientId: authInfo.clientId,
      subject,
      connectionId,
      scopes: new Set(authInfo.scopes.filter(isMcpScope)),
      exchange,
    },
  };
}

async function serveMcp(
  request: Request,
  runtime: RuntimeContext,
  parsedBody?: unknown,
  authInfo?: AuthInfo
): Promise<Response> {
  const handler = createMcpHandler(() => createJustOneMcpServer(runtime), {
    route: MCP_ROUTE,
    legacy: "stateless",
    corsOptions: false,
    allowedOriginHostnames: "*",
  });
  return await handler.fetch(request, {
    ...(parsedBody !== undefined ? { parsedBody } : {}),
    ...(authInfo !== undefined ? { authInfo } : {}),
  });
}

function metadataResponse(config: WorkerOAuthConfig): Response {
  return Response.json(protectedResourceMetadata(config), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

function jwksResponse(config: WorkerOAuthConfig): Response {
  try {
    const keySet = parsePrivateJwkSet(config.privateJwks);
    return Response.json(keySet.publicJwks, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return serviceUnavailableResponse();
  }
}

function invalidTokenResponse(): Response {
  return bearerAuthChallengeResponse(
    new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid"),
    { resourceMetadataUrl: MCP_PROTECTED_RESOURCE_METADATA_URL }
  );
}

function hiddenCredentialError(
  credential: Extract<ReturnType<typeof classifyCredential>, { kind: "invalid" }>
): Response {
  return Response.json(
    {
      error: credential.status === 401 ? "invalid_token" : "invalid_request",
      ...(credential.status === 400 ? { error_description: credential.reason } : {}),
    },
    { status: credential.status, headers: { "Cache-Control": "no-store" } }
  );
}

function serviceUnavailableResponse(): Response {
  return Response.json(
    { error: "temporarily_unavailable" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    }
  );
}

function isMcpScope(value: string): value is McpOAuthScope {
  return value === "mcp:catalog:read" || value === "mcp:api:call" || value === "mcp:account:read";
}

function getWorkerCatalogManager(env: Env): CatalogManager {
  const config = loadWorkerConfig(env);
  const key = JSON.stringify({
    baseUrl: config.baseUrl,
    openapiUrl: config.openapiUrl,
    openapiZhUrl: config.openapiZhUrl,
    ttl: config.catalogMemoryTtlMs,
    searchV2Enabled: config.searchV2Enabled,
  });
  if (!cachedManager || cachedManager.key !== key) {
    cachedManager = {
      key,
      manager: new CatalogManager(
        new KvCatalogStore(env.JUSTONEAPI_MCP_CATALOG),
        bundledCatalog,
        config
      ),
    };
  }
  return cachedManager.manager;
}

async function healthResponse(
  request: Request,
  env: Env,
  manager: CatalogManager
): Promise<Response> {
  let bundle = null;
  try {
    bundle = await manager.load();
  } catch {
    // handled below
  }

  const isAdmin = Boolean(
    env.JUSTONEAPI_ADMIN_TOKEN &&
    request.headers.get("x-admin-token") &&
    (await timingSafeEqual(env.JUSTONEAPI_ADMIN_TOKEN, request.headers.get("x-admin-token") ?? ""))
  );

  const body: Record<string, unknown> = {
    ok: Boolean(bundle),
    catalog_loaded: Boolean(bundle),
    endpoint_count: bundle?.meta.endpoint_count ?? 0,
    version: "2.0.0",
  };

  if (isAdmin && bundle) {
    body.catalog_release_id = bundle.meta.release_id;
    body.catalog_generated_at = bundle.meta.generated_at;
    body.last_refresh = await manager.loadLastRefresh();
    body.openapi_sha256 = bundle.meta.source.openapi_sha256.slice(0, 12);
    body.openapi_zh_sha256 = bundle.meta.source.openapi_zh_sha256?.slice(0, 12);
  }

  return Response.json(body, { status: bundle ? 200 : 503 });
}
