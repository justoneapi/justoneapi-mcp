import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/common/logger.js";
import { RuntimeContext } from "../src/common/runtime.js";
import { getAccountBalance, getUsageSummary } from "../src/tools/account.js";

function runtime(privateCatalogTerms = ["private-registry-canary"]): RuntimeContext {
  return {
    transport: "stdio",
    config: {
      baseUrl: "https://api.justoneapi.test",
      openapiUrl: "https://docs.justoneapi.test/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.test/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60000,
      debug: false,
      searchV2Enabled: false,
      privateCatalogTerms,
      timeoutMs: 1000,
      retry: 0,
    },
    catalogManager: undefined,
    logger: silentLogger,
    getToken: () => "token-test",
    isAdmin: () => true,
  } as unknown as RuntimeContext;
}

describe("account tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets account balance with token query parameter", async () => {
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        seenUrl = String(url);
        return Response.json({
          code: 0,
          message: null,
          data: { balance: "123.4500", currency: "CNY" },
        });
      })
    );

    const result = await getAccountBalance({}, runtime());

    expect(seenUrl).toBe("https://api.justoneapi.test/user/get-balance?token=token-test");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ balance: "123.4500", currency: "CNY" });
    }
  });

  it("gets usage summary and truncates large arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          message: null,
          data: {
            apiTrendDaily: {
              days: Array.from({ length: 3 }, (_, id) => `2026-06-${id + 1}`),
              series: [{ name: "api", data: Array.from({ length: 12 }, (_, id) => id) }],
            },
          },
        })
      )
    );

    const result = await getUsageSummary({ max_items: 5 }, runtime());

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it.each([
    ["get_account_balance", () => getAccountBalance({}, runtime([]))],
    ["get_usage_summary", () => getUsageSummary({ max_items: 5 }, runtime([]))],
  ])("fails closed before fetching when %s has no private registry", async (_tool, invoke) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(invoke()).rejects.toMatchObject({
      payload: { code: "SECURITY_CONFIGURATION_REQUIRED" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks an unsafe balance response without echoing its internal identifier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: 0, data: { balance: "1.00", routeRef: "private-route" } })
      )
    );

    const rejection = (await getAccountBalance({}, runtime()).catch((error: unknown) => error)) as {
      message?: string;
      payload?: { code?: string };
    };
    expect(rejection).toMatchObject({ payload: { code: "UNSAFE_RESPONSE" } });
    expect(rejection.message).not.toContain("routeRef");
  });

  it("scans the complete usage response before truncation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 0,
          data: {
            rows: [{ label: "public" }, { label: "private-registry-canary" }],
          },
        })
      )
    );

    await expect(getUsageSummary({ max_items: 1 }, runtime())).rejects.toMatchObject({
      payload: { code: "UNSAFE_RESPONSE" },
    });
  });
});
