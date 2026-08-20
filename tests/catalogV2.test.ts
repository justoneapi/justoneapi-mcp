import { describe, expect, it } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { normalizeHighlights } from "../src/catalog/highlights.js";
import { catalogSemanticSignature } from "../src/catalog/manager.js";
import { assertSafeCatalogValue, assertSafePublicValue } from "../src/catalog/security.js";
import { searchEndpoints } from "../src/search/rank.js";

function build(openapi: Record<string, unknown>) {
  return buildCatalogBundle({
    openapi,
    openapiText: JSON.stringify(openapi),
    openapiUrl: "https://docs.justoneapi.com/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    generatedAt: "2026-07-15T00:00:00.000Z",
  });
}

describe("structured catalog projection", () => {
  it("changes the release ID when only localized OpenAPI content changes", () => {
    const openapi = {
      paths: {
        "/api/web/test/v1": {
          get: { summary: "Test", description: "Get public test data.", responses: {} },
        },
      },
    };
    const localized = (description: string) => ({
      paths: {
        "/api/web/test/v1": {
          get: { summary: "测试", description, responses: {} },
        },
      },
    });
    const buildLocalized = (description: string) =>
      buildCatalogBundle({
        openapi,
        openapiZh: localized(description),
        openapiText: JSON.stringify(openapi),
        openapiZhText: JSON.stringify(localized(description)),
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
        generatedAt: "2026-07-15T00:00:00.000Z",
      });

    expect(buildLocalized("获取公开测试数据。").meta.release_id).not.toBe(
      buildLocalized("获取公开测试资料。").meta.release_id
    );
  });

  it("includes projected endpoint semantics in the release identity", () => {
    const document = (description: string) => ({
      paths: {
        "/api/web/test/v1": {
          get: { summary: "Test", description, operationId: "getApiWebTestV1", responses: {} },
        },
      },
    });
    const sourceText = JSON.stringify(document("Source text held constant."));
    const buildWithFixedSource = (description: string) =>
      buildCatalogBundle({
        openapi: document(description),
        openapiText: sourceText,
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
        generatedAt: "2026-07-15T00:00:00.000Z",
      });

    expect(buildWithFixedSource("First public meaning.").meta.release_id).not.toBe(
      buildWithFixedSource("Second public meaning.").meta.release_id
    );
  });

  it("rejects mixed English and Chinese OpenAPI releases or operation sets", () => {
    const document = (releaseId: string, path = "/api/web/test/v1") => ({
      "x-openapi-release-id": releaseId,
      paths: {
        [path]: {
          get: { operationId: "getApiWebTestV1", summary: "Test", responses: {} },
        },
      },
    });
    const buildPair = (
      english: ReturnType<typeof document>,
      chinese: ReturnType<typeof document>
    ) =>
      buildCatalogBundle({
        openapi: english,
        openapiZh: chinese,
        openapiText: JSON.stringify(english),
        openapiZhText: JSON.stringify(chinese),
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      });

    expect(() => buildPair(document("release-a"), document("release-b"))).toThrow(
      /release identifiers do not match/
    );
    expect(() =>
      buildPair(document("release-a"), document("release-a", "/api/web/other/v1"))
    ).toThrow(/operation sets do not match/);
    const legacy = document("");
    expect(() =>
      buildCatalogBundle({
        openapi: legacy,
        openapiZh: legacy,
        openapiText: JSON.stringify(legacy),
        openapiZhText: JSON.stringify(legacy),
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
        requireLocalizedReleaseId: true,
      })
    ).toThrow(/release identifiers are required/);
  });

  it("rejects localized highlight machine metadata drift", () => {
    const document = (kind: "CAPABILITY" | "LIMITATION", fieldPath: string) => ({
      "x-openapi-release-id": "release-a",
      paths: {
        "/api/web/test/v1": {
          get: {
            operationId: "getApiWebTestV1",
            summary: "Test",
            "x-highlights": [
              {
                type: "TIP",
                kind,
                content: "Public capability.",
                concept: "public_capability",
                aliases: ["public capability", "公开能力"],
                fieldPaths: [fieldPath],
              },
            ],
            responses: {},
          },
        },
      },
    });
    const buildPair = (chinese: ReturnType<typeof document>) =>
      buildCatalogBundle({
        openapi: document("CAPABILITY", "$.data.value"),
        openapiZh: chinese,
        openapiText: JSON.stringify(document("CAPABILITY", "$.data.value")),
        openapiZhText: JSON.stringify(chinese),
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
        requireLocalizedReleaseId: true,
      });

    expect(() => buildPair(document("LIMITATION", "$.data.value"))).toThrow(
      /highlight machine metadata do not match/
    );
    expect(() => buildPair(document("CAPABILITY", "$.data.other"))).toThrow(
      /highlight machine metadata do not match/
    );
    expect(() =>
      normalizeHighlights([
        {
          kind: "CAPABILITY",
          content: "Invalid path.",
          concept: "invalid_path",
          aliases: ["invalid path"],
          fieldPaths: ["$.database.value"],
        },
      ])
    ).toThrow(/supported \$\.data JSONPath subset/);
  });

  it("merges localized use cases into Chinese search and semantic diff", () => {
    const english = {
      "x-openapi-release-id": "localized-release",
      paths: {
        "/api/taobao/product-monitor/v1": {
          get: {
            operationId: "getTaobaoProductMonitorV1",
            summary: "Product monitor",
            description: "Get public product monitoring data.",
            "x-use-cases": [
              { id: "price-monitoring", title: "Price monitoring", aliases: ["price watch"] },
            ],
            responses: {},
          },
        },
      },
    };
    const localized = (title: string) => ({
      "x-openapi-release-id": "localized-release",
      paths: {
        "/api/taobao/product-monitor/v1": {
          get: {
            operationId: "getTaobaoProductMonitorV1",
            summary: "商品监控",
            description: "获取公开商品监控数据。",
            "x-use-cases": [{ id: "price-monitoring", title, aliases: ["价格监控"] }],
            responses: {},
          },
        },
      },
    });
    const buildLocalized = (title: string) =>
      buildCatalogBundle({
        openapi: english,
        openapiZh: localized(title),
        openapiText: JSON.stringify(english),
        openapiZhText: JSON.stringify(localized(title)),
        openapiUrl: "https://docs.justoneapi.com/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
        requireLocalizedReleaseId: true,
      }).catalog.endpoints[0];

    const endpoint = buildLocalized("价格监控");
    expect(endpoint.use_cases).toEqual([
      {
        id: "price-monitoring",
        title: "价格监控",
        title_en: "Price monitoring",
        aliases: ["price watch", "价格监控"],
      },
    ]);
    const search = searchEndpoints(
      [endpoint],
      { query: "价格监控", platform: "taobao" },
      { mode: "v2" }
    );
    expect(search.results[0]?.endpoint_id).toBe(endpoint.endpoint_id);
    expect(catalogSemanticSignature(endpoint)).not.toBe(
      catalogSemanticSignature(buildLocalized("价格追踪"))
    );
  });

  it("ignores response field metadata, schemas, and examples", () => {
    const openapi = {
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Generic payload",
            "x-key-response-fields": [{ path: "$.data.opaqueReviewMetric" }],
            "x-response-field-descriptions": [
              {
                name: "opaqueReviewMetric",
                path: "$.data.opaqueReviewMetric",
                type: "number",
                description: "Schema-only opaque review metric.",
              },
            ],
            "x-contract-status": { status: "verified", revision: "private-revision" },
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { opaqueReviewMetric: { type: "number" } },
                    },
                    example: { code: 0, data: { opaqueReviewMetric: 42 } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const endpoint = build(openapi).catalog.endpoints[0];
    expect(endpoint).not.toHaveProperty("key_response_fields");
    expect(endpoint).not.toHaveProperty("response_field_descriptions");
    expect(endpoint).not.toHaveProperty("contract_status");
    expect(endpoint).not.toHaveProperty("response_schema");
    expect(endpoint).not.toHaveProperty("response_example");
    expect(
      searchEndpoints([endpoint], { query: "opaque review metric" }, { mode: "v2" }).results
    ).toEqual([]);
  });

  it("keeps structured discovery metadata and ignores response contracts", () => {
    const openapi = {
      tags: [
        {
          name: "Taobao and Tmall",
          description: "Taobao and Tmall public marketplace data.",
          "x-platform-id": "taobao-and-tmall",
          "x-platform-aliases": ["Taobao", "淘宝"],
          "x-platform-detection-aliases": ["Taobao", "淘宝"],
        },
      ],
      paths: {
        "/api/taobao/get-item-detail/v2": {
          get: {
            tags: ["Taobao and Tmall"],
            summary: "Product detail",
            description: "Get public Taobao product detail data for catalog monitoring.",
            operationId: "getTaobaoProductDetailV2",
            "x-search-aliases": ["coupon price", "券后价"],
            "x-use-cases": [
              "Catalog monitoring",
              {
                id: "price-monitoring",
                title: "Price monitoring",
                aliases: ["价格监控"],
              },
            ],
            "x-endpoint-family": "taobao.product_detail",
            "x-recommended": true,
            "x-contract-status": { status: "verified", reason: "Verified public contract" },
            "x-highlights": [
              "Inspect pagination guidance.",
              {
                type: "tip",
                content: "Includes the coupon-adjusted price.",
                kind: "capability",
                concept: "post_coupon_price",
                aliases: ["coupon price", "券后价"],
                fieldPaths: ["$.data.priceAfterCoupon"],
              },
            ],
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [
                        { $ref: "#/components/schemas/ProductDetailSuccess" },
                        { $ref: "#/components/schemas/PublicBusinessError" },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        "/api/taobao/internal/v1": {
          get: {
            tags: ["Taobao and Tmall"],
            summary: "Hidden",
            "x-docs-hidden": true,
            responses: {},
          },
        },
      },
      components: {
        schemas: {
          ProductDetailSuccess: {
            type: "object",
            required: ["code", "data"],
            properties: {
              code: { type: "integer", const: 0 },
              data: {
                type: "object",
                properties: {
                  priceAfterCoupon: {
                    type: "number",
                    title: "Coupon-adjusted price",
                    unit: "currency",
                    "x-unit": "CNY",
                  },
                  encodedPayload: {
                    type: "string",
                    contentEncoding: "base64",
                    contentMediaType: "application/json",
                  },
                  labels: {
                    type: "array",
                    prefixItems: [{ const: "primary" }],
                    contains: { const: "featured" },
                    minContains: 1,
                  },
                  metadata: {
                    type: "object",
                    properties: { kind: { type: "string" }, value: { type: "string" } },
                    if: { properties: { kind: { const: "text" } } },
                    then: { required: ["value"] },
                    unevaluatedProperties: false,
                  },
                },
              },
            },
          },
          PublicBusinessError: {
            type: "object",
            required: ["code"],
            properties: {
              code: { type: "integer", enum: [1] },
              message: { type: "string" },
            },
          },
        },
      },
    };

    const bundle = build(openapi);
    expect(bundle.catalog.endpoints).toHaveLength(1);
    const endpoint = bundle.catalog.endpoints[0];
    expect(endpoint.platform_aliases).toContain("淘宝");
    expect(endpoint.platform_description_en).toBe("Taobao and Tmall public marketplace data.");
    expect(endpoint.platform_detection_aliases).toEqual(["Taobao", "淘宝"]);
    expect(endpoint.highlights).toEqual([
      expect.objectContaining({ kind: "GUIDANCE", content: "Inspect pagination guidance." }),
      expect.objectContaining({
        kind: "CAPABILITY",
        concept: "post_coupon_price",
        fieldPaths: ["$.data.priceAfterCoupon"],
      }),
    ]);
    expect(endpoint.use_cases).toEqual([
      { description: "Catalog monitoring" },
      {
        id: "price-monitoring",
        title: "Price monitoring",
        description: undefined,
        aliases: ["价格监控"],
      },
    ]);
    expect(endpoint.recommended).toBe(true);
    expect(endpoint.endpoint_family).toBe("taobao.product_detail");
    expect(endpoint).not.toHaveProperty("response_schema");
    expect(endpoint).not.toHaveProperty("response_example");
  });

  it("keeps optional discovery metadata compatible when use cases and families are absent", () => {
    const bundle = build({
      paths: {
        "/api/web/render/v1": {
          get: {
            summary: "Render page v1",
            description: "Render a public web page.",
            "x-search-aliases": ["render page", "page renderer"],
            responses: {},
          },
        },
        "/api/web/render/v2": {
          get: {
            summary: "Render page v2",
            description: "Render a public web page.",
            "x-search-aliases": ["render page", "page renderer"],
            "x-recommended": true,
            responses: {},
          },
        },
      },
    });
    const v1 = bundle.catalog.endpoints.find(
      (endpoint) => endpoint.endpoint_id === "web.render_v1"
    )!;
    const v2 = bundle.catalog.endpoints.find(
      (endpoint) => endpoint.endpoint_id === "web.render_v2"
    )!;

    expect(v1.use_cases).toEqual([]);
    expect(v2.use_cases).toEqual([]);
    expect(v1.endpoint_family).toBe("web_render");
    expect(v2.endpoint_family).toBe(v1.endpoint_family);
    expect(v1.search_aliases).toEqual(["render page", "page renderer"]);
    expect(v2.search_aliases).toEqual(["render page", "page renderer"]);
    expect(v1.recommended).toBe(false);
    expect(v2.recommended).toBe(true);

    const ranked = searchEndpoints(
      bundle.catalog.endpoints,
      { query: "render page" },
      { mode: "v2" }
    );
    expect(ranked.results).toHaveLength(1);
    expect(ranked.results[0].endpoint_id).toBe("web.render_v2");
    expect(ranked.results[0].alternatives?.map((item) => item.endpoint_id)).toEqual([
      "web.render_v1",
    ]);
  });

  it("does not include response schema changes in catalog semantics", () => {
    const withUnit = (unit: string) =>
      build({
        paths: {
          "/api/web/metric/v1": {
            get: {
              summary: "Metric",
              "x-contract-status": { status: "verified" },
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: { type: "number", "x-unit": unit },
                    },
                  },
                },
              },
            },
          },
        },
      }).catalog.endpoints[0];

    const count = withUnit("count");
    const percent = withUnit("percent");
    expect(count).not.toHaveProperty("response_schema");
    expect(count).not.toHaveProperty("response_schema_hash");
    expect(catalogSemanticSignature(count)).toBe(catalogSemanticSignature(percent));
  });

  it("does not generate a synthetic response example", () => {
    const bundle = build({
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            description: "Get public test data.",
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { code: { type: "integer" }, data: {} },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(bundle.catalog.endpoints[0]).not.toHaveProperty("response_example");
  });

  it.each(["pending", "partial", "stale"] as const)(
    "ignores %s response contract metadata",
    (status) => {
      const bundle = build({
        paths: {
          "/api/web/test/v1": {
            get: {
              summary: "Test",
              "x-contract-status": { status },
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          code: { type: "integer", const: 0 },
                          data: {
                            type: "object",
                            properties: { unverifiedClaim: { type: "string" } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const endpoint = bundle.catalog.endpoints[0];
      expect(endpoint).not.toHaveProperty("contract_status");
      expect(endpoint).not.toHaveProperty("response_schema");
      expect(endpoint).not.toHaveProperty("response_example");
    }
  );

  it("does not validate response envelopes", () => {
    const operation = (schema?: Record<string, unknown>) => ({
      summary: "Test",
      "x-contract-status": { status: "verified" },
      responses: schema ? { 200: { content: { "application/json": { schema } } } } : {},
    });
    const document = (schema?: Record<string, unknown>) => ({
      paths: { "/api/web/test/v1": { get: operation(schema) } },
    });

    expect(() => build(document())).not.toThrow();
    expect(() =>
      build(
        document({
          type: "object",
          required: ["code", "data"],
          properties: {
            code: { type: "integer", const: 0 },
            data: { type: "object", properties: { value: { type: "string" } } },
          },
        })
      )
    ).not.toThrow();
  });

  it("does not expose a response example for verified response metadata", () => {
    const schema = { type: "object", properties: { publicValue: { type: "string" } } };
    const bundle = build({
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            "x-contract-status": { status: "verified" },
            responses: { 200: { content: { "application/json": { schema } } } },
          },
        },
      },
    });

    expect(bundle.catalog.endpoints[0]).not.toHaveProperty("response_example");
  });

  it("does not inject unrelated domain canonical terms into every endpoint", () => {
    const bundle = build({
      paths: {
        "/api/web/ping/v1": {
          get: {
            summary: "Service ping",
            description: "Check public service availability.",
            operationId: "pingWebV1",
            responses: {},
          },
        },
      },
    });
    expect(bundle.catalog.endpoints[0].search_tokens).not.toEqual(
      expect.arrayContaining(["search", "detail", "comment", "video", "note"])
    );
  });

  it("rejects more than one recommended endpoint in the same family", () => {
    expect(() =>
      build({
        paths: {
          "/api/web/render/v1": {
            get: {
              summary: "Render v1",
              "x-endpoint-family": "web.render",
              "x-recommended": true,
              responses: {},
            },
          },
          "/api/web/render/v2": {
            get: {
              summary: "Render v2",
              "x-endpoint-family": "web.render",
              "x-recommended": true,
              responses: {},
            },
          },
        },
      })
    ).toThrow(/multiple recommended versions/i);
  });

  it("includes discovery metadata and parameter prose in semantic diff", () => {
    const base = build({
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            description: "Get public test data.",
            parameters: [
              {
                name: "query",
                in: "query",
                description: "Search query.",
                schema: { type: "string" },
              },
            ],
            responses: {},
          },
        },
      },
    }).catalog.endpoints[0];
    const variants = [
      { ...base, title: "修改后的中文标题" },
      { ...base, description: "修改后的中文描述。" },
      { ...base, description_en: "Changed description." },
      {
        ...base,
        params: [{ ...base.params[0], description_en: "Changed parameter description." }],
      },
      {
        ...base,
        params: [{ ...base.params[0], default: "public-default" }],
      },
      { ...base, operation_id: "getApiWebTestReplacementV1" },
      {
        ...base,
        highlights: [
          {
            type: "INFO" as const,
            content: "New guidance.",
            kind: "GUIDANCE" as const,
          },
        ],
      },
      { ...base, recommended: true },
    ];
    const signatures = new Set([
      catalogSemanticSignature(base),
      ...variants.map(catalogSemanticSignature),
    ]);
    expect(signatures.size).toBe(variants.length + 1);
  });
});

describe("public catalog leak prevention", () => {
  it.each([
    ["external", "https://private-provider.invalid/secret-schema.json"],
    ["unresolvable", "#/components/schemas/PrivateProviderRoute"],
  ])("ignores an %s response ref", (_name, ref) => {
    const bundle = build({
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            responses: {
              200: { content: { "application/json": { schema: { $ref: ref } } } },
            },
          },
        },
      },
    });
    expect(bundle.catalog.endpoints[0]).not.toHaveProperty("response_schema");
    expect(JSON.stringify(bundle.catalog)).not.toContain(ref);
  });

  it("scans catalog source metadata as part of the public bundle", () => {
    const openapi = { paths: {} };
    expect(() =>
      buildCatalogBundle({
        openapi,
        openapiText: JSON.stringify(openapi),
        openapiUrl: "https://catalog.internal/openapi.json",
        openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      })
    ).toThrow(/Non-public URL/);
  });

  it.each([
    ["internal wording", { description: "Uses the upstream response for pagination." }],
    ["supplier identity", { description: "Internal supplier Acme handles this request." }],
    ["internal URL", { description: "See https://router.internal/contract." }],
  ])("fails closed for %s", (_name, mutation) => {
    const description = mutation.description;
    const openapi = {
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            description,
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { value: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(() => build(openapi)).toThrow(/Unsafe|Non-public URL/);
  });

  it.each(["actualSupplier", "routeRef", "functionId", "accessToken", "token"])(
    "does not publish response property %s",
    (responseProperty) => {
      const bundle = build({
        paths: {
          "/api/web/test/v1": {
            get: {
              summary: "Test",
              description: "Get public test data.",
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { [responseProperty]: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const endpoint = bundle.catalog.endpoints[0];
      expect(endpoint).not.toHaveProperty("response_schema");
      expect(endpoint.search_tokens).not.toContain(responseProperty);
    }
  );

  it("allows customer-facing 1688 supplier research wording", () => {
    expect(() =>
      build({
        paths: {
          "/api/1688/search/v1": {
            get: {
              summary: "1688 product search",
              description: "Find public marketplace data for 1688 supplier research.",
              responses: {},
            },
          },
        },
      })
    ).not.toThrow();
  });

  it("allows customer-facing marketplace supplier and route fields", () => {
    expect(() =>
      assertSafePublicValue({
        supplierName: "Marketplace shop",
        route: "Public delivery route",
        deliveryRoute: "Customer-visible delivery route",
        tokenCount: 3,
      })
    ).not.toThrow();
  });

  it("allows public Xiaohongshu short-link hosts while retaining URL guards", () => {
    for (const value of ["http://xhslink.com/demo", "https://public.xhslink.com/demo"]) {
      expect(() => assertSafePublicValue({ value })).not.toThrow();
    }

    for (const value of [
      "https://xhslink.com:8443/demo",
      "https://user:password@xhslink.com/demo",
      "https://xhslink.com/demo?token=real-secret",
    ]) {
      expect(() => assertSafePublicValue({ value })).toThrow(/URL/);
    }
  });

  it.each([
    "internalRouteRef",
    "supplierRouteId",
    "debugFunctionId",
    "internalCandidateId",
    "actualSupplierCode",
    "providerFunctionId",
    "internalAddress",
    "backendIp",
    "upstreamHost",
    "databaseRowId",
    "proxyAddress",
  ])("rejects compound internal key %s", (key) => {
    expect(() => assertSafePublicValue({ [key]: "public-looking-value" })).toThrow(
      /Unsafe public catalog key/
    );
  });

  it.each([
    "userAccessToken",
    "clientSecretValue",
    "apiKeyHash",
    "authorizationHeader",
    "sessionCookieValue",
    "refreshTokenValue",
  ])("rejects compound credential key %s", (key) => {
    expect(() => assertSafePublicValue({ [key]: "redacted" })).toThrow(/Unsafe public catalog key/);
  });

  it.each([
    "_https://router.internal/path",
    "0https://10.0.0.1/path",
    "prefix_https://192.168.1.2/a",
    "_//router.internal/path",
  ])("rejects an embedded or prefixed internal URL %s", (value) => {
    expect(() => assertSafePublicValue({ value })).toThrow(/URL|network address/);
  });

  it.each([
    "https://example.com/?foo=sk%2Dproj%2Dabcdefghijklmnopqrstuv",
    "https://example.com/?foo=bearer%20abcdefghijk",
    "https://example.com/?foo=10%2E0%2E0%2E1",
    "https://example.com/?foo=https%3A%2F%2Fuser%3Apass%40example.com",
    "https://example.com/?foo=sk%252Dproj%252Dabcdefghijklmnopqrstuv",
  ])("rejects an encoded unsafe URL query value in %s", (value) => {
    expect(() => assertSafePublicValue({ value }, "public catalog")).toThrow();
  });

  it.each([
    "10.0.0.1",
    "192.168.1.9",
    "172.16.0.1:8080",
    "router.internal",
    "localhost",
    "fd00::1",
    "fe80::1",
  ])("rejects a bare private network address %s", (value) => {
    expect(() => assertSafePublicValue({ value })).toThrow(/network address/);
  });

  it.each([
    "supplier-maps itemId",
    "supplier_maps itemId",
    "supplierMaps itemId",
    "sent_to_supplier as sku",
    "sent-to-the-supplier",
    "upstream_response fields",
    "upstreamResponse fields",
  ])("rejects internal implementation wording variant %s", (value) => {
    expect(() => assertSafePublicValue({ value })).toThrow(/Unsafe internal wording/);
  });

  it.each(["apiKey", "access_token", "Authorization", "client-secret"])(
    "rejects credential parameter %s if it reaches a public catalog",
    (apiName) => {
      expect(() =>
        assertSafePublicValue({
          params: [{ api_name: apiName, default: "sk_live_1234567890abcdef" }],
        })
      ).toThrow(/Credential parameter/);
    }
  );

  it("fails the build when an omitted credential parameter carries values", () => {
    const openapi = {
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            description: "Get public test data.",
            parameters: [
              {
                name: "api_key",
                in: "query" as const,
                schema: { type: "string", enum: ["sk_live_1234567890abcdef"] },
              },
            ],
            responses: {},
          },
        },
      },
    };
    expect(() => build(openapi)).toThrow(/Credential value/);
  });

  it("omits valueless credential parameters from the public catalog", () => {
    const bundle = build({
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Test",
            description: "Get public test data.",
            parameters: [{ name: "api_key", in: "header" as const, schema: { type: "string" } }],
            responses: {},
          },
        },
      },
    });
    expect(bundle.catalog.endpoints[0].params).toEqual([]);
  });

  it("retains cookies_buffer only as the documented legacy form pagination state", () => {
    const description =
      "Opaque pagination state returned by the previous WeChat web search response. Leave it empty for the first page. For this POST endpoint, send it in an application/x-www-form-urlencoded form body.";
    const bundle = build({
      paths: {
        "/api/weixin/search-article/v1": {
          post: {
            summary: "WeChat article search",
            description: "Search public WeChat articles.",
            parameters: [
              {
                name: "keyword",
                in: "query" as const,
                required: true,
                schema: { type: "string" },
              },
              {
                name: "cookies_buffer",
                in: "query" as const,
                required: false,
                description,
                schema: { type: "string", default: "" },
              },
            ],
            requestBody: {
              content: {
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    required: ["keyword"],
                    properties: {
                      keyword: { type: "string" },
                      cookies_buffer: { type: "string", default: "", description },
                    },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    });
    const endpoint = bundle.catalog.endpoints[0];

    expect(endpoint.params.map(({ api_name, in: location }) => [api_name, location])).toEqual([
      ["keyword", "body"],
      ["cookies_buffer", "body"],
    ]);
    expect(endpoint.pagination).toEqual({ type: "cursor", params: ["cookies_buffer"] });
    expect(() => assertSafeCatalogValue(endpoint, "public endpoint")).not.toThrow();
    expect(() => assertSafePublicValue(endpoint, "runtime response")).toThrow(
      /Credential parameter/
    );
  });

  it.each([
    ["wrong path", "/api/weixin/search-account/v1", "POST", false, "string", ""],
    ["wrong method", "/api/weixin/search-article/v1", "GET", false, "string", ""],
    ["required", "/api/weixin/search-article/v1", "POST", true, "string", ""],
    ["wrong type", "/api/weixin/search-article/v1", "POST", false, "object", ""],
    ["nonempty default", "/api/weixin/search-article/v1", "POST", false, "string", "state"],
  ])(
    "rejects a cookies_buffer exception with %s",
    (_name, path, method, required, type, defaultValue) => {
      const description =
        "Opaque pagination state returned by the previous WeChat web search response. Leave it empty for the first page.";
      const openapi = {
        paths: {
          [path]: {
            [method.toLowerCase()]: {
              summary: "Public search",
              description: "Search public content.",
              parameters: [
                {
                  name: "cookies_buffer",
                  in: "query" as const,
                  required,
                  description,
                  schema: { type, default: defaultValue },
                },
              ],
              responses: {},
            },
          },
        },
      };
      expect(() => build(openapi)).toThrow(/Credential value|legacy public pagination/);
    }
  );

  it("rejects cookies_buffer examples and unrelated cookie-like fields in catalog mode", () => {
    const allowedParameter = {
      name: "cookies_buffer",
      api_name: "cookies_buffer",
      in: "body",
      required: false,
      type: "string",
      default: "",
      description:
        "Opaque pagination state returned by the previous WeChat web search response. Leave it empty for the first page.",
      description_en:
        "Opaque pagination state returned by the previous WeChat web search response. Leave it empty for the first page.",
    };
    const endpoint = {
      method: "POST",
      path: "/api/weixin/search-article/v1",
      params: [allowedParameter],
    };
    expect(() => assertSafeCatalogValue(endpoint)).not.toThrow();
    expect(() =>
      assertSafeCatalogValue({
        ...endpoint,
        params: [{ ...allowedParameter, example: "opaque-state" }],
      })
    ).toThrow(/Credential parameter/);
    expect(() =>
      assertSafeCatalogValue({
        ...endpoint,
        params: [{ ...allowedParameter, value: "opaque-state" }],
      })
    ).toThrow(/Credential parameter/);
    expect(() =>
      assertSafeCatalogValue({ ...endpoint, params: [{ ...allowedParameter, api_name: "cookie" }] })
    ).toThrow(/Credential parameter/);
    expect(() =>
      assertSafeCatalogValue({ code: 0, data: { cookies_buffer: "opaque-state" } })
    ).toThrow(/Unsafe public catalog key/);
    expect(() =>
      assertSafeCatalogValue({
        ...endpoint,
        leakedOutsideParameterContext: allowedParameter,
      })
    ).toThrow(/Credential parameter/);
  });
});
