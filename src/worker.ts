import { createMcpHandler } from "agents/mcp";
import { CatalogManager } from "./catalog/manager.js";
import { parseAuthToken, timingSafeEqual } from "./common/auth.js";
import { stderrLogger } from "./common/logger.js";
import { RuntimeContext } from "./common/runtime.js";
import { createJustOneMcpServer } from "./server/createServer.js";
import { loadWorkerConfig } from "./config.js";
import { bundledCatalog } from "./generated/bundledCatalog.js";
import { KvCatalogStore } from "./worker/kvCatalogStore.js";

let cachedManager: {
  key: string;
  manager: CatalogManager;
} | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const manager = getWorkerCatalogManager(env);

    if (url.pathname === "/health") {
      return await healthResponse(request, env, manager);
    }

    if (url.pathname !== "/mcp") {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const config = loadWorkerConfig(env);
    const runtime: RuntimeContext = {
      transport: "worker",
      config,
      catalogManager: manager,
      logger: stderrLogger,
      getToken: () => parseAuthToken(request.headers),
      isAdmin: async () => {
        const expected = env.JUSTONEAPI_ADMIN_TOKEN;
        const provided = request.headers.get("x-admin-token");
        return Boolean(expected && provided && (await timingSafeEqual(expected, provided)));
      },
    };

    const server = createJustOneMcpServer(runtime);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
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

function getWorkerCatalogManager(env: Env): CatalogManager {
  const config = loadWorkerConfig(env);
  const key = JSON.stringify({
    baseUrl: config.baseUrl,
    openapiUrl: config.openapiUrl,
    openapiZhUrl: config.openapiZhUrl,
    ttl: config.catalogMemoryTtlMs,
    searchV2Enabled: config.searchV2Enabled,
    privateCatalogTerms: config.privateCatalogTerms.join("\0"),
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
    version: bundledCatalog.meta.generated_at ? "2.0.0" : "2.0.0",
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
