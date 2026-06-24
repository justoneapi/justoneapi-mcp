import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/common/logger.js";
import { RuntimeContext } from "../src/common/runtime.js";
import { getAccountBalance, getUsageSummary } from "../src/tools/account.js";

const ctx = {
  transport: "stdio",
  config: {
    baseUrl: "https://api.justoneapi.test",
    openapiUrl: "https://docs.justoneapi.test/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.test/openapi-zh.json",
    catalogRefreshIntervalMs: 0,
    catalogMemoryTtlMs: 60000,
    debug: false,
    timeoutMs: 1000,
    retry: 0,
  },
  catalogManager: undefined,
  logger: silentLogger,
  getToken: () => "token-test",
  isAdmin: () => true,
} as unknown as RuntimeContext;

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

    const result = await getAccountBalance({}, ctx);

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

    const result = await getUsageSummary({ max_items: 5 }, ctx);

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });
});
