import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

describe("v2 stdio adapter", () => {
  it("serves the CLI tool surface through a real child-process connection", async () => {
    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: process.cwd(),
      env: {
        ...inheritedEnvironment,
        JUSTONEAPI_TOKEN: "A".repeat(16),
        JUSTONEAPI_CATALOG_REFRESH_INTERVAL_MS: "0",
        JUSTONEAPI_DEBUG: "false",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-adapter-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("call_endpoint");
      expect(tools.map((tool) => tool.name)).toContain("refresh_catalog");
      expect(tools.find((tool) => tool.name === "call_endpoint")?._meta?.securitySchemes).toEqual([
        { type: "noauth" },
      ]);
    } finally {
      await Promise.allSettled([client.close(), transport.close()]);
    }
  });
});
