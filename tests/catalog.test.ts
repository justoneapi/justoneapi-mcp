import { describe, expect, it } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";

describe("buildCatalogBundle", () => {
  it("builds endpoint ids, localized descriptions, and snake_case params", () => {
    const openapi = {
      paths: {
        "/api/douyin/get-video-comment/v1": {
          get: {
            tags: ["Douyin"],
            summary: "Video Comments",
            description: "Get comments.",
            operationId: "getApiDouyinGetVideoCommentV1",
            parameters: [
              {
                name: "token",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "awemeId",
                in: "query",
                required: true,
                description: "Video id.",
                schema: { type: "string" },
              },
            ],
            "x-order": "10",
            "x-api-version": "v1",
            responses: {},
          },
        },
      },
    };
    const openapiZh = {
      paths: {
        "/api/douyin/get-video-comment/v1": {
          get: {
            tags: ["抖音"],
            summary: "视频评论",
            description: "获取评论。",
            operationId: "getApiDouyinGetVideoCommentV1",
            parameters: [
              {
                name: "awemeId",
                in: "query",
                required: true,
                description: "视频 ID。",
                schema: { type: "string" },
              },
            ],
            responses: {},
          },
        },
      },
    };

    const bundle = buildCatalogBundle({
      openapi,
      openapiZh,
      openapiText: JSON.stringify(openapi),
      openapiZhText: JSON.stringify(openapiZh),
      openapiUrl: "https://example.com/openapi.json",
      openapiZhUrl: "https://example.com/openapi-zh.json",
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(bundle.meta.endpoint_count).toBe(1);
    expect(bundle.catalog.endpoints[0]).toMatchObject({
      endpoint_id: "douyin.get_video_comment_v1",
      platform: "douyin",
      title: "视频评论",
      title_en: "Video Comments",
    });
    expect(bundle.catalog.endpoints[0].params).toEqual([
      expect.objectContaining({
        name: "aweme_id",
        api_name: "awemeId",
        description: "视频 ID。",
        description_en: "Video id.",
      }),
    ]);
  });
});
