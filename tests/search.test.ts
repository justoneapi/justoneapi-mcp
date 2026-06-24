import { describe, expect, it } from "vitest";
import { bundledCatalog } from "../src/generated/bundledCatalog.js";
import { searchEndpoints } from "../src/search/rank.js";

describe("searchEndpoints", () => {
  it("finds common natural-language endpoint requests", () => {
    expect(
      searchEndpoints(bundledCatalog.catalog.endpoints, {
        query: "抖音视频评论",
        limit: 3,
      }).results[0].endpoint_id
    ).toBe("douyin.get_video_comment_v1");

    expect(
      searchEndpoints(bundledCatalog.catalog.endpoints, {
        query: "小红薯笔记详情",
        limit: 3,
      }).results[0].endpoint_id
    ).toMatch(/^xiaohongshu\.get_note_detail_v/);

    expect(
      searchEndpoints(bundledCatalog.catalog.endpoints, {
        query: "亚马逊商品评论",
        limit: 3,
      }).results[0].endpoint_id
    ).toBe("amazon.get_product_top_reviews_v1");
  });

  it("honors platform filters", () => {
    const output = searchEndpoints(bundledCatalog.catalog.endpoints, {
      query: "视频搜索",
      platform: "快手",
      limit: 5,
    });

    expect(output.normalized.platform).toBe("kuaishou");
    expect(output.results.every((result) => result.platform === "kuaishou")).toBe(true);
    expect(output.results[0].endpoint_id).toBe("kuaishou.search_video_v2");
  });
});
