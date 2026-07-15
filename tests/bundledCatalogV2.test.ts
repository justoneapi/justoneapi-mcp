import { describe, expect, it } from "vitest";
import { normalizeHighlights } from "../src/catalog/highlights.js";
import { assertSafeCatalogValue, parsePrivateCatalogTerms } from "../src/catalog/security.js";
import { loadWorkerConfig } from "../src/config.js";
import { bundledCatalog } from "../src/generated/bundledCatalog.js";
import { searchEndpoints } from "../src/search/rank.js";

const endpoints = bundledCatalog.catalog.endpoints;

function search(query: string, platform?: string) {
  return searchEndpoints(endpoints, { query, platform, limit: 20 }, { mode: "v2" });
}

describe("released bundled catalog V2 fail-safe smoke", () => {
  it("passes the complete bundled catalog through the release safety gate", () => {
    expect(() =>
      assertSafeCatalogValue(
        bundledCatalog,
        "bundled catalog",
        parsePrivateCatalogTerms(process.env.JUSTONEAPI_PRIVATE_CATALOG_TERMS)
      )
    ).not.toThrow();
    expect(endpoints.every((endpoint) => !endpoint.endpoint_family?.includes(":"))).toBe(true);
  });

  it("keeps V2 disabled until the released catalog has structured discovery metadata", () => {
    expect(loadWorkerConfig({}).searchV2Enabled).toBe(false);
    expect(searchEndpoints(endpoints, { query: "淘宝券后价" }).ranking_version).toBe("legacy");
  });

  it("fails closed when a release requires an unconfigured private-term registry", () => {
    expect(() => loadWorkerConfig({ JUSTONEAPI_REQUIRE_PRIVATE_CATALOG_TERMS: "true" })).toThrow(
      /registry is required/i
    );
    expect(
      loadWorkerConfig({
        JUSTONEAPI_REQUIRE_PRIVATE_CATALOG_TERMS: "true",
        JUSTONEAPI_PRIVATE_CATALOG_TERMS: '["private-provider.example"]',
      }).privateCatalogTerms
    ).toEqual(["private-provider.example"]);
    for (const malformed of ['["private-provider.example",]', "{}", '["", "term"]']) {
      expect(() =>
        loadWorkerConfig({
          JUSTONEAPI_REQUIRE_PRIVATE_CATALOG_TERMS: "true",
          JUSTONEAPI_PRIVATE_CATALOG_TERMS: malformed,
        })
      ).toThrow(/registry JSON/i);
    }
  });

  it("contains the reviewed structured highlight release", () => {
    const highlights = endpoints.flatMap((endpoint) => [
      ...normalizeHighlights(endpoint.highlights),
    ]);
    const byKind = highlights.reduce<Record<string, number>>((counts, highlight) => {
      counts[highlight.kind] = (counts[highlight.kind] ?? 0) + 1;
      return counts;
    }, {});

    expect(highlights).toHaveLength(29);
    expect(byKind).toEqual({
      CAPABILITY: 7,
      CONDITION: 9,
      GUIDANCE: 7,
      LIMITATION: 6,
    });
    expect(
      normalizeHighlights(
        endpoints.find((endpoint) => endpoint.endpoint_id === "taobao.get_item_detail_v4")
          ?.highlights ?? []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "CAPABILITY", concept: "post_coupon_price" }),
      ])
    );
    expect(
      normalizeHighlights(
        endpoints.find((endpoint) => endpoint.endpoint_id === "xiaohongshu.get_note_detail_v1")
          ?.highlights ?? []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "LIMITATION", concept: "video_download" }),
      ])
    );
    expect(
      normalizeHighlights(
        endpoints.find((endpoint) => endpoint.endpoint_id === "xiaohongshu.get_note_detail_v6")
          ?.highlights ?? []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "CAPABILITY", concept: "video_download" }),
        expect.objectContaining({ kind: "CAPABILITY", concept: "video_note_details" }),
        expect.objectContaining({ kind: "LIMITATION", concept: "image_text_note_details" }),
      ])
    );
  });

  it("selects the reviewed coupon capability instead of guidance", () => {
    const output = search("淘宝券后价");
    expect(output.results[0]?.endpoint_id).toBe("taobao.get_item_detail_v4");
    expect(output.results[0]?.matched_capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "CAPABILITY", concept: "post_coupon_price" }),
      ])
    );
  });

  it("uses capability and limitation metadata when choosing note-detail versions", () => {
    const videoOutput = search("下载视频");
    expect(videoOutput.results[0]?.endpoint_id).toBe("xiaohongshu.get_note_detail_v6");
    expect(videoOutput.results.map((result) => result.endpoint_id)).not.toContain(
      "xiaohongshu.get_note_detail_v1"
    );
    expect(videoOutput.results[0]?.matched_capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "CAPABILITY", concept: "video_download" }),
      ])
    );

    const imageOutput = search("小红书图文笔记详情");
    expect(imageOutput.results[0]?.endpoint_id).toBe("xiaohongshu.get_note_detail_v1");
    expect(imageOutput.results.map((result) => result.endpoint_id)).not.toContain(
      "xiaohongshu.get_note_detail_v6"
    );
  });

  it.each([
    ["蒲公英曝光中位数", "xiaohongshu_pgy.api_pgy_kol_data_core_data_v1"],
    ["抖音粉丝画像城市分布", "douyin_xingtu.gw_api_data_sp_get_author_fans_distribution_v1"],
  ])("resolves bilingual catalog query %s", (query, endpointId) => {
    expect(search(query).results[0]?.endpoint_id).toBe(endpointId);
  });

  it("does not inject generic discovery tokens into every endpoint", () => {
    for (const token of ["search", "detail", "comment", "video", "note"]) {
      const matching = endpoints.filter((endpoint) => endpoint.search_tokens.includes(token));
      expect(matching.length).toBeLessThan(endpoints.length);
      if (token !== "search") expect(matching.length).toBeGreaterThan(0);
    }
  });

  it.each([
    "",
    "public data",
    "get data",
    "provides access",
    "integrate workflows",
    "提供数据",
    "用于工作流",
    "用于",
    "适用于",
    "数据",
    "a",
    "x",
    "v",
    "图",
    "价",
  ])(
    "returns no released-catalog results for non-specific intent %j in either ranking mode",
    (query) => {
      expect(searchEndpoints(endpoints, { query }, { mode: "v2" }).results).toEqual([]);
      expect(searchEndpoints(endpoints, { query }, { mode: "legacy" }).results).toEqual([]);
    }
  );
});
