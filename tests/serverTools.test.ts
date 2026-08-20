import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { RuntimeContext } from "../src/common/runtime.js";
import { createJustOneMcpServer } from "../src/server/createServer.js";
import { GetUsageSummaryInput } from "../src/tools/account.js";
import { CallEndpointInput } from "../src/tools/callEndpoint.js";

describe("public MCP tool schemas", () => {
  it("does not advertise response truncation controls", async () => {
    const server = createJustOneMcpServer({} as RuntimeContext);
    const client = new Client({ name: "schema-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      expect(Object.keys(byName.get("call_endpoint")?.inputSchema.properties ?? {})).toEqual([
        "endpoint_id",
        "params",
      ]);
      expect(byName.get("call_endpoint")?.inputSchema.properties).not.toHaveProperty("max_items");
      expect(byName.get("get_usage_summary")?.inputSchema.properties ?? {}).toEqual({});
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  it("silently ignores max_items from legacy callers", () => {
    expect(
      CallEndpointInput.parse({ endpoint_id: "test.endpoint_v1", params: {}, max_items: 1 })
    ).toEqual({ endpoint_id: "test.endpoint_v1", params: {} });
    expect(GetUsageSummaryInput.parse({ max_items: 1 })).toEqual({});
  });
});
