import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogManager } from "../src/catalog/manager.js";
import { catalogSafetyContext } from "../src/catalog/release.js";
import type { CatalogBundle, CatalogStore } from "../src/catalog/types.js";
import type { Logger } from "../src/common/logger.js";
import type { RuntimeContext } from "../src/common/runtime.js";
import { getAccountBalance } from "../src/tools/account.js";
import { callEndpoint } from "../src/tools/callEndpoint.js";
import { OAUTH_ACCESS_TOKEN, OAUTH_DELEGATION_TOKEN } from "./oauthFixtures.js";

const LEGACY_TOKEN = "L".repeat(16);

const bundle: CatalogBundle = {
  meta: {
    release_id: "oauth-upstream-test",
    generator_version: "6",
    generated_at: "2026-08-20T00:00:00.000Z",
    endpoint_count: 2,
    localization_available: false,
    source: {
      openapi_url: "https://example.invalid/openapi.json",
      openapi_sha256: "a",
    },
    security: catalogSafetyContext(),
  },
  catalog: {
    endpoints: [
      endpoint("test.get_v1", "GET", "/api/test/get"),
      endpoint("test.post_v1", "POST", "/api/test/post", "application/x-www-form-urlencoded"),
    ],
  },
};

function endpoint(
  endpointId: string,
  method: "GET" | "POST",
  path: string,
  contentType?: string
): CatalogBundle["catalog"]["endpoints"][number] {
  return {
    endpoint_id: endpointId,
    platform: "test",
    platform_name: "Test",
    platform_aliases: ["test"],
    method_name: endpointId.split(".")[1],
    operation_id: endpointId,
    method,
    path,
    content_type: contentType,
    version: "v1",
    title: "Test",
    title_en: "Test",
    description: "",
    description_en: "",
    tags: [],
    tags_en: [],
    order: 1,
    hidden: false,
    deprecated: false,
    recommended: false,
    highlights: [],
    highlights_en: [],
    params: [
      {
        name: "keyword",
        api_name: "keyword",
        in: method === "POST" ? "body" : "query",
        required: true,
        type: "string",
        description: "Keyword",
        description_en: "Keyword",
      },
    ],
    search_tokens: ["test"],
  };
}

class MemoryStore implements CatalogStore {
  async load() {
    return bundle;
  }
  async save() {}
}

function runtime(
  kind: "legacy" | "oauth",
  options: { retry?: number; logger?: Logger; exchange?: ReturnType<typeof vi.fn> } = {}
): RuntimeContext {
  const config = {
    baseUrl: "https://api.justoneapi.test",
    openapiUrl: "https://docs.justoneapi.test/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.test/openapi-zh.json",
    catalogRefreshIntervalMs: 0,
    catalogMemoryTtlMs: 60_000,
    debug: false,
    searchV2Enabled: false,
    timeoutMs: 1_000,
    retry: options.retry ?? 2,
  };
  const base = {
    transport: "worker" as const,
    oauthAdvertised: true,
    config,
    catalogManager: new CatalogManager(new MemoryStore(), bundle, config),
    logger: options.logger ?? { info() {}, warn() {}, error() {} },
  };
  return kind === "oauth"
    ? {
        ...base,
        auth: {
          kind: "oauth",
          accessToken: OAUTH_ACCESS_TOKEN,
          accessTokenHash: "f".repeat(64),
          clientId: "client",
          subject: "subject",
          connectionId: "connection",
          scopes: new Set(["mcp:api:call", "mcp:account:read"]),
          exchange:
            options.exchange ??
            vi.fn(async () => ({
              token: OAUTH_DELEGATION_TOKEN,
              expiresAt: Math.floor(Date.now() / 1000) + 120,
            })),
        },
      }
    : {
        ...base,
        auth: { kind: "api-key", source: "authorization-bearer", token: LEGACY_TOKEN },
      };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OAuth downstream credential isolation", () => {
  it.each([
    ["unknown endpoint", { endpoint_id: "missing", params: {} }],
    ["invalid params", { endpoint_id: "test.get_v1", params: {} }],
  ])("does not consume delegation for %s", async (_name, input) => {
    const exchange = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(callEndpoint(input, runtime("oauth", { exchange }))).rejects.toBeDefined();
    expect(exchange).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["test.get_v1", ""],
    ["test.post_v1", "token-free-body"],
  ])("sends delegation only in Authorization for %s and never logs secrets", async (endpointId) => {
    const logged: unknown[] = [];
    const logger: Logger = {
      info: (event, fields) => logged.push({ event, fields }),
      warn() {},
      error() {},
    };
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      expect(url).not.toContain(OAUTH_ACCESS_TOKEN);
      expect(url).not.toContain(OAUTH_DELEGATION_TOKEN);
      expect(body).not.toContain(OAUTH_ACCESS_TOKEN);
      expect(body).not.toContain(OAUTH_DELEGATION_TOKEN);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${OAUTH_DELEGATION_TOKEN}`
      );
      return Response.json({ code: 0, data: { ok: true } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await callEndpoint(
      { endpoint_id: endpointId, params: { keyword: "news" } },
      runtime("oauth", { logger })
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const serializedLog = JSON.stringify(logged);
    expect(serializedLog).not.toContain(OAUTH_ACCESS_TOKEN);
    expect(serializedLog).not.toContain(OAUTH_DELEGATION_TOKEN);
    expect(serializedLog).toContain("ffffffffffff");
  });

  it.each([502, 503, 504])(
    "dispatches call_endpoint exactly once on uncertain HTTP %s for OAuth and legacy",
    async (status) => {
      for (const kind of ["oauth", "legacy"] as const) {
        const fetchMock = vi.fn(async () =>
          Response.json({ code: status, message: "uncertain" }, { status })
        );
        vi.stubGlobal("fetch", fetchMock);
        await callEndpoint(
          { endpoint_id: "test.get_v1", params: { keyword: "news" } },
          runtime(kind)
        );
        expect(fetchMock).toHaveBeenCalledOnce();
      }
    }
  );

  it.each(["network", "timeout"] as const)(
    "dispatches call_endpoint exactly once on uncertain %s for OAuth and legacy",
    async (failure) => {
      for (const kind of ["oauth", "legacy"] as const) {
        const fetchMock = vi.fn(async () => {
          const error = new Error(failure);
          if (failure === "timeout") error.name = "AbortError";
          throw error;
        });
        vi.stubGlobal("fetch", fetchMock);
        await expect(
          callEndpoint({ endpoint_id: "test.get_v1", params: { keyword: "news" } }, runtime(kind))
        ).rejects.toMatchObject({
          payload: { code: failure === "timeout" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR" },
        });
        expect(fetchMock).toHaveBeenCalledOnce();
      }
    }
  );

  it("preserves the legacy GET/query and POST/form token encoding", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        seen.push({ url: String(input), body: String(init?.body ?? "") });
        return Response.json({ code: 0, data: {} });
      })
    );
    await callEndpoint(
      { endpoint_id: "test.get_v1", params: { keyword: "news" } },
      runtime("legacy")
    );
    await callEndpoint(
      { endpoint_id: "test.post_v1", params: { keyword: "news" } },
      runtime("legacy")
    );
    expect(seen).toEqual([
      {
        url: `https://api.justoneapi.test/api/test/get?token=${LEGACY_TOKEN}&keyword=news`,
        body: "",
      },
      {
        url: "https://api.justoneapi.test/api/test/post",
        body: `token=${LEGACY_TOKEN}&keyword=news`,
      },
    ]);
  });

  it("uses one OAuth account dispatch but retains legacy account retries", async () => {
    const oauthFetch = vi.fn(async () =>
      Response.json({ code: 503, message: "uncertain" }, { status: 503 })
    );
    vi.stubGlobal("fetch", oauthFetch);
    await getAccountBalance({}, runtime("oauth", { retry: 2 }));
    expect(oauthFetch).toHaveBeenCalledOnce();
    const [oauthUrl, oauthInit] = oauthFetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(oauthUrl)).toBe("https://api.justoneapi.test/user/get-balance");
    expect(new Headers(oauthInit.headers).get("authorization")).toBe(
      `Bearer ${OAUTH_DELEGATION_TOKEN}`
    );

    const legacyFetch = vi.fn(async () =>
      Response.json({ code: 503, message: "retryable" }, { status: 503 })
    );
    vi.stubGlobal("fetch", legacyFetch);
    await getAccountBalance({}, runtime("legacy", { retry: 1 }));
    expect(legacyFetch).toHaveBeenCalledTimes(2);
    expect(String(legacyFetch.mock.calls[0][0])).toBe(
      `https://api.justoneapi.test/user/get-balance?token=${LEGACY_TOKEN}`
    );
  });
});
