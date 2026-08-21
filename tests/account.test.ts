import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/common/logger.js";
import { RuntimeContext } from "../src/common/runtime.js";
import { GetUsageSummaryInput, getAccountBalance, getUsageSummary } from "../src/tools/account.js";

function runtime(): RuntimeContext {
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
      timeoutMs: 1000,
      retry: 0,
    },
    catalogManager: undefined,
    logger: silentLogger,
    auth: { kind: "api-key", source: "env", token: "token-test" },
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

  it("gets the complete usage summary without truncating arrays or strings", async () => {
    const payload = {
      code: 0,
      message: null,
      data: {
        apiTrendDaily: {
          days: Array.from({ length: 125 }, (_, id) => `2026-06-${id + 1}`),
          series: [{ name: "api", data: Array.from({ length: 125 }, (_, id) => id) }],
        },
        description: "用".repeat(4001),
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload))
    );

    const result = await getUsageSummary({}, runtime());

    expect(result.success).toBe(true);
    expect(result.data).toEqual(payload.data);
    expect(result.raw).toEqual(payload);
    expect(result.truncated).toBe(false);
    expect(result).not.toHaveProperty("truncation");
  });

  it("accepts and ignores the removed max_items field from legacy callers", () => {
    expect(GetUsageSummaryInput.parse({ max_items: 1 })).toEqual({});
    expect(GetUsageSummaryInput.shape).not.toHaveProperty("max_items");
  });

  it.each([
    ["get_account_balance", () => getAccountBalance({}, runtime())],
    ["get_usage_summary", () => getUsageSummary({}, runtime())],
  ])("calls %s without catalog security configuration", async (_tool, invoke) => {
    const fetchSpy = vi.fn(async () => Response.json({ code: 0, data: { value: "ok" } }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(invoke()).resolves.toMatchObject({ success: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("returns a previously blocked balance response unchanged", async () => {
    const payload = { code: 0, data: { balance: "1.00", routeRef: "private-route" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload))
    );

    await expect(getAccountBalance({}, runtime())).resolves.toMatchObject({
      success: true,
      data: payload.data,
      raw: payload,
    });
  });

  it("returns a previously blocked usage response unchanged", async () => {
    const payload = {
      code: 0,
      data: {
        rows: [{ label: "public" }, { label: "complete-response-canary" }],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload))
    );

    const result = await getUsageSummary({}, runtime());

    expect(result).toMatchObject({ success: true, truncated: false, raw: payload });
    if (result.success) {
      expect(result.data).toEqual(payload.data);
    }
  });
});
