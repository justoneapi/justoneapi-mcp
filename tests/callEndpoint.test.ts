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

const legacyPaginationBundle: CatalogBundle = {
  ...bundle,
  meta: { ...bundle.meta, endpoint_count: 1 },
  catalog: {
    endpoints: [
      {
        ...bundle.catalog.endpoints[0],
        endpoint_id: "weixin.search_article_v1",
        platform: "weixin",
        platform_name: "微信",
        platform_aliases: ["微信", "weixin", "wechat"],
        method_name: "search_article_v1",
        operation_id: "postApiWeixinSearchArticleV1",
        method: "POST",
        path: "/api/weixin/search-article/v1",
        content_type: "application/x-www-form-urlencoded",
        params: [
          {
            name: "keyword",
            api_name: "keyword",
            in: "body",
            required: true,
            type: "string",
            description: "关键词",
            description_en: "Keyword",
          },
          {
            name: "cookies_buffer",
            api_name: "cookies_buffer",
            in: "body",
            required: false,
            type: "string",
            default: "",
            description: "由上一次响应返回的不透明分页状态。第一页留空。",
            description_en:
              "Opaque pagination state returned by the previous WeChat web search response. Leave it empty for the first page.",
          },
        ],
        search_tokens: ["weixin", "article", "search"],
        pagination: { type: "cursor", params: ["cookies_buffer"] },
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

function runtime(
  privateCatalogTerms: string[] = ["private-registry-canary"],
  activeBundle: CatalogBundle = bundle
): RuntimeContext {
  return {
    transport: "stdio",
    config: {
      baseUrl: "https://api.justoneapi.test",
      openapiUrl: "https://example.com/openapi.json",
      openapiZhUrl: "https://example.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60000,
      debug: false,
      searchV2Enabled: false,
      privateCatalogTerms,
      timeoutMs: 1000,
      retry: 0,
    },
    catalogManager: new CatalogManager(new MemoryStore(), activeBundle, {
      baseUrl: "https://api.justoneapi.test",
      openapiUrl: "https://example.com/openapi.json",
      openapiZhUrl: "https://example.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60000,
      debug: false,
      searchV2Enabled: false,
      privateCatalogTerms: [],
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

  it("calls the endpoint without a private runtime registry and returns the payload unchanged", async () => {
    const payload = {
      code: 0,
      message: null,
      data: { routeRef: "private-route", link: "http://127.0.0.1/data" },
    };
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callEndpoint(
      {
        endpoint_id: "kuaishou.search_video_v2",
        params: { keyword: "美食" },
      },
      runtime([])
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: payload.data, raw: payload });
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

  it("returns ordinary public CDN and article URLs unchanged", async () => {
    const payload = {
      code: 0,
      message: null,
      data: {
        video_url: "https://d111111abcdef8.cloudfront.net:8443/media/video.mp4?quality=hd",
        article_url: "https://www.nytimes.com/2026/07/15/example-article.html",
      },
    };
    const original = structuredClone(payload);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload))
    );

    const result = await callEndpoint(
      {
        endpoint_id: "kuaishou.search_video_v2",
        params: { keyword: "news" },
      },
      runtime()
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.raw).toEqual(original);
      expect(result.data).toEqual(original.data);
    }
    expect(payload).toEqual(original);
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

  it.each(["CgoIARABGAE=", null])(
    "retains the verified legacy pagination response state %j without changing JSON",
    async (nextState) => {
      let requestBody = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
          requestBody = String(init?.body ?? "");
          return Response.json({
            code: 0,
            message: null,
            data: {
              data: [{ title: "article" }],
              cookies: { cookies_buffer: nextState, extra: "kept" },
              offset: 20,
            },
          });
        })
      );

      const result = await callEndpoint(
        {
          endpoint_id: "weixin.search_article_v1",
          params: { keyword: "news", cookies_buffer: "previous-page" },
        },
        runtime(["private-registry-canary"], legacyPaginationBundle)
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          cookies: { cookies_buffer: nextState, extra: "kept" },
          offset: 20,
        });
      }
      expect(requestBody).toContain("keyword=news");
      expect(requestBody).toContain("cookies_buffer=previous-page");
    }
  );

  it.each([
    ["wrong path", { code: 0, data: { cookies_buffer: "next" } }],
    ["nested container", { code: 0, data: { nested: { cookies: { cookies_buffer: "next" } } } }],
    ["non-string state", { code: 0, data: { cookies: { cookies_buffer: { value: "next" } } } }],
    ["numeric state", { code: 0, data: { cookies: { cookies_buffer: 123 } } }],
    ["session sibling", { code: 0, data: { cookies: { cookies_buffer: "next", session: "x" } } }],
    [
      "secret state",
      { code: 0, data: { cookies: { cookies_buffer: "sk-proj-abcdefghijklmnopqrstuv" } } },
    ],
    [
      "private term state",
      { code: 0, data: { cookies: { cookies_buffer: "private-registry-canary" } } },
    ],
    [
      "private URL state",
      { code: 0, data: { cookies: { cookies_buffer: "https://router.internal/page" } } },
    ],
    ["business error", { code: 202, data: { cookies: { cookies_buffer: "next" } } }],
  ])("does not block a legacy pagination response with %s", async (_name, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload))
    );
    const result = await callEndpoint(
      { endpoint_id: "weixin.search_article_v1", params: { keyword: "news" } },
      runtime([], legacyPaginationBundle)
    );

    expect(result.success).toBe(payload.code === 0);
    if (result.success) expect(result.data).toEqual(payload.data);
  });

  it.each([
    ["internal key", { code: 0, data: { routeRef: "route-1" } }, []],
    [
      "legacy pagination response on another endpoint",
      { code: 0, data: { cookies: { cookies_buffer: "opaque-state" } } },
      [],
    ],
    ["private supplier", { code: 0, data: { provider: "KELE" } }, ["KELE"]],
    [
      "private domain",
      { code: 0, data: { providerHost: "private-vendor.example" } },
      ["private-vendor.example"],
    ],
    ["internal URL", { code: 0, data: { link: "https://router.internal/data" } }, []],
    ["localhost trailing dot", { code: 0, data: { link: "http://localhost./data" } }, []],
    [
      "percent-encoded localhost trailing dot",
      { code: 0, data: { link: "http://%6cocalhost./data" } },
      [],
    ],
    ["internal host trailing dot", { code: 0, data: { link: "https://foo.internal./data" } }, []],
    ["link-local URL", { code: 0, data: { link: "http://169.254.169.254/latest/meta-data" } }, []],
    [
      "registered supplier URL",
      { code: 0, data: { link: "https://media.private-vendor.example/video.mp4" } },
      ["private-vendor.example"],
    ],
    [
      "Unicode IDN registered supplier host",
      { code: 0, data: { link: "https://例子.公司/video.mp4" } },
      ["例子.公司"],
    ],
    [
      "punycode host registered as Unicode IDN",
      { code: 0, data: { link: "https://xn--fsqu00a.xn--55qx5d/video.mp4" } },
      ["例子.公司"],
    ],
    [
      "Unicode IDN host registered as punycode",
      { code: 0, data: { link: "https://例子.公司/video.mp4" } },
      ["xn--fsqu00a.xn--55qx5d"],
    ],
    [
      "host extracted from a registered full URL",
      { code: 0, data: { link: "https://private-fixture.invalid/other" } },
      ["https://private-fixture.invalid/original"],
    ],
    [
      "subdomain matched from a registered full URL",
      { code: 0, data: { link: "https://cdn.private-fixture.invalid/other" } },
      ["https://private-fixture.invalid/original"],
    ],
    [
      "punycode host extracted from a registered Unicode full URL",
      { code: 0, data: { link: "https://xn--fsqu00a.xn--55qx5d/other" } },
      ["https://例子.公司/original"],
    ],
    [
      "non-ASCII registered private name in plain text",
      { code: 0, data: { source: "私有供应商" } },
      ["私有供应商"],
    ],
    [
      "non-ASCII registered private name in an encoded URL path",
      {
        code: 0,
        data: {
          link: "https://public-cdn.example/%E7%A7%81%E6%9C%89%E4%BE%9B%E5%BA%94%E5%95%86/video",
        },
      },
      ["私有供应商"],
    ],
    [
      "percent-encoded registered supplier host",
      { code: 0, data: { link: "https://%70rivate-vendor.example/video.mp4" } },
      ["private-vendor.example"],
    ],
    [
      "percent-encoded registered supplier path",
      { code: 0, data: { link: "https://public-cdn.example/%70rivate-vendor/video.mp4" } },
      ["private-vendor"],
    ],
    [
      "percent-encoded registered supplier fragment",
      { code: 0, data: { link: "https://public-cdn.example/video#%70rivate-vendor" } },
      ["private-vendor"],
    ],
    [
      "percent-encoded secret path",
      {
        code: 0,
        data: {
          link: "https://public-cdn.example/sk%252Dproj%252Dabcdefghijklmnopqrstuv/video",
        },
      },
      [],
    ],
    [
      "percent-encoded internal fragment",
      { code: 0, data: { link: "https://public-cdn.example/video#%72outeRef" } },
      [],
    ],
    [
      "URL userinfo",
      { code: 0, data: { link: "https://user:secret@api.justoneapi.com/data" } },
      [],
    ],
    ["scheme-relative URL", { code: 0, data: { link: "//router.internal/data" } }, []],
    ["data URL", { code: 0, data: { link: "data:foo/bar,private" } }, []],
    ["mailto URL", { code: 0, data: { link: "mailto:user@example.com" } }, []],
    ["gopher URL", { code: 0, data: { link: "gopher://example.com/1" } }, []],
    ["ssh URL", { code: 0, data: { link: "ssh://example.com/private" } }, []],
    ["chrome URL", { code: 0, data: { link: "chrome://settings" } }, []],
    ["about URL", { code: 0, data: { link: "about:blank" } }, []],
    ["telephone URL", { code: 0, data: { link: "tel:+12025550123" } }, []],
    ["custom URL", { code: 0, data: { link: "custom:private" } }, []],
    ["malformed HTTP URL", { code: 0, data: { link: "http:example.com/private" } }, []],
    ["angle-bracket mailto URL", { code: 0, data: { link: "<mailto:user@example.com>" } }, []],
    ["braced custom URL", { code: 0, data: { link: "{custom:private}" } }, []],
    ["path-prefixed mailto URL", { code: 0, data: { link: "foo/mailto:user@example.com" } }, []],
    ["days pseudo-scheme", { code: 0, data: { link: "days:private" } }, []],
    ["file URL", { code: 0, data: { link: "file:/etc/passwd" } }, []],
    [
      "javascript URL",
      { code: 0, data: { link: "javascript:location.href='https://router.internal'" } },
      [],
    ],
    [
      "encoded credential query",
      { code: 0, data: { link: "https://api.justoneapi.com/data?%2574oken=private" } },
      [],
    ],
    [
      "credential query on an arbitrary public host",
      {
        code: 0,
        data: {
          link: "https://d111111abcdef8.cloudfront.net/video.mp4?download_token=private",
        },
      },
      [],
    ],
    [
      "nested encoded private URL on an arbitrary public host",
      {
        code: 0,
        data: {
          link: "https://redirect.example-cdn.com/?target=http%253A%252F%252F169.254.169.254%252Fmetadata",
        },
      },
      [],
    ],
    [
      "api_key query",
      { code: 0, data: { link: "https://www.nytimes.com/story?api_key=private" } },
      [],
    ],
    [
      "multiply encoded api_key query",
      { code: 0, data: { link: "https://www.nytimes.com/story?%2561pi_key=private" } },
      [],
    ],
    [
      "excessively encoded secret query",
      {
        code: 0,
        data: {
          link: "https://www.nytimes.com/story?redirect=https%252525253A%252525252F%252525252Frouter.internal%252525252Fdata",
        },
      },
      [],
    ],
    [
      "accessToken query",
      { code: 0, data: { link: "https://www.nytimes.com/story?accessToken=private" } },
      [],
    ],
    [
      "signature query",
      { code: 0, data: { link: "https://www.nytimes.com/story?signature=private" } },
      [],
    ],
    [
      "comma-concatenated non-HTTP URL",
      {
        code: 0,
        data: { link: "https://cdn.public.test/a,gopher://else.public.test/x" },
      },
      [],
    ],
    [
      "semicolon-concatenated non-HTTP URL",
      {
        code: 0,
        data: { link: "https://cdn.public.test/a;gopher://else.public.test/x" },
      },
      [],
    ],
    [
      "comma-concatenated credential-bearing HTTPS URL",
      {
        code: 0,
        data: {
          link: "https://a.public.test/x,https://user:secret@b.public.test/y",
        },
      },
      [],
    ],
    [
      "semicolon-concatenated credential-bearing HTTPS URL",
      {
        code: 0,
        data: {
          link: "https://a.public.test/x;https://user:secret@b.public.test/y",
        },
      },
      [],
    ],
    [
      "comma-concatenated scheme-relative URL",
      {
        code: 0,
        data: { link: "https://a.public.test/x,//b.public.test/y" },
      },
      [],
    ],
    [
      "encoded credential-bearing HTTPS URL in a path",
      {
        code: 0,
        data: {
          link: "https://a.public.test/x%2Chttps%3A%2F%2Fuser%3Asecret%40b.public.test%2Fy",
        },
      },
      [],
    ],
    [
      "encoded scheme-relative URL in a fragment",
      {
        code: 0,
        data: { link: "https://a.public.test/x#item%2C%2F%2Fb.public.test%2Fy" },
      },
      [],
    ],
    ["CGNAT URL", { code: 0, data: { link: "http://100.64.0.1/data" } }, []],
    ["IPv4-mapped loopback", { code: 0, data: { link: "http://[::ffff:127.0.0.1]/" } }, []],
    [
      "hex-normalized IPv4-mapped private address",
      { code: 0, data: { link: "http://[::ffff:7f00:1]/" } },
      [],
    ],
  ])(
    "returns a previously blocked runtime payload for %s",
    async (_name, payload, privateTerms) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(payload))
      );
      const result = await callEndpoint(
        {
          endpoint_id: "kuaishou.search_video_v2",
          params: { keyword: "美食" },
        },
        runtime(privateTerms)
      );

      expect(result).toMatchObject({ success: true, data: payload.data, raw: payload });
    }
  );

  it.each([
    "sk-proj-abcdefghijklmnopqrstuv",
    "prefix_sk-proj-abcdefghijklmnopqrstuv",
    "AKIAABCDEFGHIJKLMNOP",
    "x_AKIAABCDEFGHIJKLMNOP",
    "token_ghp_abcdefghijklmnop",
    "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
    "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk",
    "jwt_eyJabcdefghijk.eyJabcdefghijk.abcdefghijk",
  ])("returns high-confidence secret-like runtime fixture %s unchanged", async (secret) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: 0, data: { value: secret } }))
    );
    const result = await callEndpoint(
      {
        endpoint_id: "kuaishou.search_video_v2",
        params: { keyword: "美食" },
      },
      runtime([])
    );

    expect(result).toMatchObject({ success: true, data: { value: secret } });
  });
});
