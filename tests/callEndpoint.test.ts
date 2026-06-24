import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogManager } from "../src/catalog/manager.js";
import { CatalogBundle, CatalogStore } from "../src/catalog/types.js";
import { callEndpoint } from "../src/tools/callEndpoint.js";
import { RuntimeContext } from "../src/common/runtime.js";
import { silentLogger } from "../src/common/logger.js";

const bundle: CatalogBundle = {
  meta: {
    generated_at: "2026-06-23T00:00:00.000Z",
    endpoint_count: 1,
    localization_available: true,
    source: {
      openapi_url: "https://example.com/openapi.json",
      openapi_zh_url: "https://example.com/openapi-zh.json",
      openapi_sha256: "a",
      openapi_zh_sha256: "b",
    },
  },
  catalog: {
    endpoints: [
      {
        endpoint_id: "kuaishou.search_video_v2",
        platform: "kuaishou",
        platform_name: "快手",
        platform_aliases: ["快手", "kuaishou"],
        method_name: "search_video_v2",
        operation_id: "getApiKuaishouSearchVideoV2",
        method: "GET",
        path: "/api/kuaishou/search-video/v2",
        version: "v2",
        title: "视频搜索",
        title_en: "Video Search",
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
            in: "query",
            required: true,
            type: "string",
            description: "关键词",
            description_en: "Keyword",
          },
          {
            name: "page",
            api_name: "page",
            in: "query",
            required: false,
            type: "integer",
            default: 1,
            description: "页码",
            description_en: "Page",
          },
        ],
        search_tokens: ["kuaishou", "video", "search"],
        pagination: { type: "page", params: ["page"] },
      },
    ],
  },
};

class MemoryStore implements CatalogStore {
  async load() {
    return bundle;
  }
  async save() {
    return undefined;
  }
}

function runtime(): RuntimeContext {
  return {
    transport: "stdio",
    config: {
      baseUrl: "https://api.justoneapi.test",
      openapiUrl: "https://example.com/openapi.json",
      openapiZhUrl: "https://example.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60000,
      debug: false,
      timeoutMs: 1000,
      retry: 0,
    },
    catalogManager: new CatalogManager(new MemoryStore(), bundle, {
      baseUrl: "https://api.justoneapi.test",
      openapiUrl: "https://example.com/openapi.json",
      openapiZhUrl: "https://example.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60000,
      debug: false,
      timeoutMs: 1000,
      retry: 0,
    }),
    logger: silentLogger,
    getToken: () => "test-token",
    isAdmin: () => true,
  };
}

describe("callEndpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps params, truncates large arrays, and returns next_step", async () => {
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | RequestInfo) => {
        seenUrl = String(url);
        return Response.json({
          code: 0,
          message: null,
          data: {
            items: Array.from({ length: 25 }, (_, id) => ({ id })),
            nextCursor: "cursor-1",
          },
        });
      })
    );

    const result = await callEndpoint(
      {
        endpoint_id: "kuaishou.search_video_v2",
        params: { keyword: "美食", page: "2", extra: "ignored" },
        max_items: 20,
      },
      runtime()
    );

    expect(seenUrl).toContain("token=test-token");
    expect(seenUrl).toContain("keyword=%E7%BE%8E%E9%A3%9F");
    expect(seenUrl).toContain("page=2");
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { items: unknown[] }).items).toHaveLength(20);
      expect(result.truncated).toBe(true);
      expect(result.next_step?.params).toMatchObject({
        keyword: "美食",
        page: 3,
        next_cursor: "cursor-1",
      });
      expect(result.warnings).toContain("Ignored unknown parameter: extra.");
    }
  });

  it("maps upstream token limit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 602,
          message: "token limit reached",
          data: null,
        })
      )
    );

    const result = await callEndpoint(
      {
        endpoint_id: "kuaishou.search_video_v2",
        params: { keyword: "美食" },
      },
      runtime()
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TOKEN_LIMIT_EXCEEDED");
      expect(result.error.upstream_code).toBe(602);
    }
  });
});
