import { describe, expect, it } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { CatalogManager } from "../src/catalog/manager.js";
import { CatalogBundle, CatalogStore } from "../src/catalog/types.js";
import { silentLogger } from "../src/common/logger.js";
import { RuntimeContext } from "../src/common/runtime.js";
import { getEndpointSchema } from "../src/tools/getEndpointSchema.js";

class MemoryStore implements CatalogStore {
  constructor(private readonly bundle: CatalogBundle) {}
  async load() {
    return this.bundle;
  }
  async save() {
    return undefined;
  }
}

function runtime(bundle: CatalogBundle, privateCatalogTerms: string[] = []): RuntimeContext {
  const config = {
    baseUrl: "https://api.justoneapi.com",
    openapiUrl: "https://docs.justoneapi.com/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    catalogRefreshIntervalMs: 0,
    catalogMemoryTtlMs: 60_000,
    debug: false,
    searchV2Enabled: false,
    privateCatalogTerms,
    timeoutMs: 1_000,
    retry: 0,
  };
  return {
    transport: "stdio",
    config,
    catalogManager: new CatalogManager(new MemoryStore(bundle), bundle, {
      ...config,
      privateCatalogTerms: [],
    }),
    logger: silentLogger,
    getToken: () => "test-token",
    isAdmin: () => false,
  };
}

describe("get_endpoint_schema public projection", () => {
  it("returns structured highlights, response schema, and a synthetic response example", async () => {
    const openapi = {
      paths: {
        "/api/douyin/fans-portrait/v1": {
          get: {
            summary: "Audience portrait",
            description: "Get public Douyin audience portrait data.",
            operationId: "getDouyinFansPortraitV1",
            "x-search-aliases": ["audience city distribution", "粉丝画像城市分布"],
            "x-use-cases": ["Audience research"],
            "x-key-response-fields": [
              {
                path: "$.data.cityDistribution",
                name: "City distribution",
                aliases: ["城市分布"],
              },
            ],
            "x-response-field-descriptions": [
              {
                name: "city",
                path: "$.data.cityDistribution[*].city",
                type: "string",
                description: "Reviewed city name in the audience distribution.",
              },
              {
                name: "ratio",
                path: "$.data.cityDistribution[*].ratio",
                type: "number",
                description: "Reviewed audience ratio for the city.",
              },
            ],
            "x-contract-status": { status: "verified", reason: "Verified public contract" },
            "x-highlights": [
              {
                type: "info",
                content: "Includes city distribution.",
                kind: "capability",
                concept: "audience_city_distribution",
                aliases: ["city distribution", "城市分布"],
                fieldPaths: ["$.data.cityDistribution"],
              },
            ],
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [
                        {
                          type: "object",
                          required: ["code", "data"],
                          properties: {
                            code: { type: "integer", const: 0 },
                            data: {
                              type: "object",
                              properties: {
                                cityDistribution: {
                                  type: "array",
                                  items: {
                                    type: "object",
                                    properties: {
                                      city: { type: "string" },
                                      ratio: { type: "number" },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                        {
                          type: "object",
                          required: ["code"],
                          properties: {
                            code: { type: "integer", not: { const: 0 } },
                            message: { type: "string" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const bundle = buildCatalogBundle({
      openapi,
      openapiText: JSON.stringify(openapi),
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    });
    // Simulate an older cached catalog highlight to verify runtime compatibility.
    bundle.catalog.endpoints[0].highlights = ["Legacy client guidance."];

    const result = await getEndpointSchema(
      { endpoint_id: "douyin.fans_portrait_v1" },
      runtime(bundle, ["Audience portrait"])
    );
    expect(result.highlights).toEqual([
      { type: "INFO", content: "Legacy client guidance.", kind: "GUIDANCE" },
    ]);
    expect(result.highlights_en[0]).toMatchObject({
      kind: "CAPABILITY",
      concept: "audience_city_distribution",
    });
    expect(result.response_schema).toMatchObject({
      oneOf: [
        { properties: { data: { properties: { cityDistribution: { type: "array" } } } } },
        {},
      ],
    });
    expect(result.response_example).toEqual({
      code: 0,
      data: { cityDistribution: [{ city: "example", ratio: 1 }] },
    });
    expect(result.response_example_synthetic).toBe(true);
    expect(result.response_field_descriptions).toEqual([
      {
        name: "city",
        path: "$.data.cityDistribution[*].city",
        type: "string",
        description: "Reviewed city name in the audience distribution.",
        description_en: "Reviewed city name in the audience distribution.",
      },
      {
        name: "ratio",
        path: "$.data.cityDistribution[*].ratio",
        type: "number",
        description: "Reviewed audience ratio for the city.",
        description_en: "Reviewed audience ratio for the city.",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /actualSupplier|routeRef|functionId|normalizerKey|evidence|fixture/i
    );
  });
});
