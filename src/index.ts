#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { toMcpErrorPayload } from "./common/errors.js";
import {
  kuaishouSearchVideoV2,
  KuaishouSearchVideoV2Input,
} from "./tools/kuaishou/search_video_v2.js";
import { version } from "./version.js";

const server = new McpServer({
  name: "justoneapi-mcp",
  version,
});

server.registerTool(
  "kuaishou_search_video_v2",
  {
    description:
      "Search Kuaishou videos by keyword. Returns the original raw JSON response from upstream without field normalization.",
    inputSchema: KuaishouSearchVideoV2Input.shape,
  },
  async (input) => {
    try {
      const data = await kuaishouSearchVideoV2(input);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (e: unknown) {
      const m = toMcpErrorPayload(e);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `ERROR[${m.code}] (upstream=${m.upstreamCode ?? "N/A"}): ${m.message}`,
          },
        ],
      };
    }
  }
);

async function main() {
  // Validate configuration on startup
  if (!process.env.JUSTONEAPI_TOKEN?.trim()) {
    console.error(
      "[justoneapi-mcp] ERROR: JUSTONEAPI_TOKEN is required but not set.\n" +
        "Please set the JUSTONEAPI_TOKEN environment variable in your MCP host configuration."
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Optional: log startup info to stderr (won't interfere with MCP protocol on stdout)
  if (process.env.JUSTONEAPI_DEBUG?.toLowerCase() === "true") {
    console.error(`[justoneapi-mcp] Server started (version ${version})`);
    console.error(
      `[justoneapi-mcp] Base URL: ${process.env.JUSTONEAPI_BASE_URL ?? "https://api.justoneapi.com"}`
    );
  }
}

main().catch((err) => {
  console.error("[justoneapi-mcp] Fatal error:", err);
  process.exit(1);
});
