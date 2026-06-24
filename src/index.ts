#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CatalogManager } from "./catalog/manager.js";
import { FileCatalogStore } from "./node/fileCatalogStore.js";
import { createJustOneMcpServer } from "./server/createServer.js";
import { loadNodeConfig } from "./config.js";
import { bundledCatalog } from "./generated/bundledCatalog.js";
import { stderrLogger } from "./common/logger.js";
import { RuntimeContext } from "./common/runtime.js";

async function main() {
  const config = loadNodeConfig();
  const catalogManager = new CatalogManager(
    new FileCatalogStore(config.catalogCacheDir),
    bundledCatalog,
    config
  );

  const runtime: RuntimeContext = {
    transport: "stdio",
    config,
    catalogManager,
    logger: stderrLogger,
    getToken: () => process.env.JUSTONEAPI_TOKEN?.trim() || null,
    isAdmin: () => true,
  };

  if (!runtime.getToken()) {
    console.error(
      "[justoneapi-mcp] ERROR: JUSTONEAPI_TOKEN is required but not set.\n" +
        "Please set JUSTONEAPI_TOKEN in your MCP host configuration."
    );
    process.exit(1);
  }

  const server = createJustOneMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (config.debug) {
    stderrLogger.info("server_started", {
      transport: "stdio",
      catalog_endpoints: (await catalogManager.load()).meta.endpoint_count,
    });
  }

  if (config.catalogRefreshIntervalMs > 0) {
    setInterval(() => {
      void catalogManager.refresh("cron").then((result) => {
        if (!result.success) stderrLogger.warn("catalog_refresh_failed", result);
      });
    }, config.catalogRefreshIntervalMs).unref?.();
  }
}

main().catch((error) => {
  console.error("[justoneapi-mcp] Fatal error:", error);
  process.exit(1);
});
