import { describe, expect, it } from "vitest";
import { authorizeScope, type RuntimeContext } from "../src/common/runtime.js";
import { runTool } from "../src/common/toolResult.js";
import { createCanonicalToolDescriptors } from "../src/server/toolDescriptors.js";

function runtime(
  transport: "stdio" | "worker",
  oauthAdvertised = false,
  scopes: string[] = []
): RuntimeContext {
  const base = {
    config: {},
    catalogManager: {},
    logger: { info() {}, warn() {}, error() {} },
  };
  if (transport === "stdio") {
    return {
      ...base,
      transport,
      auth: { kind: "api-key", source: "env", token: "A".repeat(16) },
    } as RuntimeContext;
  }
  return {
    ...base,
    transport,
    oauthAdvertised,
    auth: oauthAdvertised
      ? {
          kind: "oauth",
          accessToken: "access",
          accessTokenHash: "hash",
          clientId: "client",
          subject: "subject",
          connectionId: "connection",
          scopes: new Set(scopes),
          exchange: async () => ({ token: "delegation", expiresAt: 1 }),
        }
      : { kind: "none" },
  } as RuntimeContext;
}

describe("canonical MCP tool descriptors", () => {
  it("advertises exact OAuth scopes for dual-mode Worker tools and hides refresh", () => {
    const descriptors = createCanonicalToolDescriptors(runtime("worker", true));
    expect(descriptors.map((tool) => tool.name)).toEqual([
      "search_endpoints",
      "get_endpoint_schema",
      "call_endpoint",
      "get_account_balance",
      "get_usage_summary",
      "list_platforms",
    ]);
    for (const descriptor of descriptors) {
      expect(descriptor.securitySchemes).toEqual([
        {
          type: "oauth2",
          scopes:
            descriptor.name === "call_endpoint"
              ? ["mcp:api:call"]
              : descriptor.name.startsWith("get_account") || descriptor.name === "get_usage_summary"
                ? ["mcp:account:read"]
                : ["mcp:catalog:read"],
        },
      ]);
      expect(descriptor._meta?.securitySchemes).toEqual(descriptor.securitySchemes);
      expect(descriptor).toHaveProperty("title");
      expect(descriptor).toHaveProperty("annotations");
      expect(descriptor).toHaveProperty("outputSchema");
    }
  });

  it("keeps OAuth linking metadata hidden in mode off and uses noauth for stdio", () => {
    const dark = createCanonicalToolDescriptors(runtime("worker", false));
    expect(dark).toHaveLength(6);
    for (const descriptor of dark) {
      expect(descriptor).not.toHaveProperty("securitySchemes");
      expect(descriptor).not.toHaveProperty("_meta");
    }

    const stdio = createCanonicalToolDescriptors(runtime("stdio"));
    expect(stdio).toHaveLength(7);
    expect(stdio.at(-1)?.name).toBe("refresh_catalog");
    for (const descriptor of stdio) {
      expect(descriptor.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(descriptor._meta?.securitySchemes).toEqual([{ type: "noauth" }]);
    }
  });

  it("marks call_endpoint as billable, destructive, non-readonly, and non-idempotent", () => {
    const descriptor = createCanonicalToolDescriptors(runtime("worker", true)).find(
      (tool) => tool.name === "call_endpoint"
    );
    expect(descriptor?.title).toContain("may incur charges");
    expect(descriptor?.description).toContain("may incur charges");
    expect(descriptor?.description).toContain("current pricing and budget");
    expect(descriptor?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("retains a tool-result relink challenge as defense in depth", async () => {
    const ctx = runtime("worker", true, ["mcp:catalog:read"]);
    const result = await runTool(() => authorizeScope(ctx, "mcp:api:call"));
    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toEqual([
      expect.stringContaining('error="insufficient_scope"'),
    ]);
  });
});
