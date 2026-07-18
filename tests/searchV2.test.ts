import { describe, expect, it } from "vitest";
import { EndpointCatalogEntry, EndpointHighlight } from "../src/catalog/types.js";
import { searchEndpoints } from "../src/search/rank.js";

function endpoint(id: string, overrides: Partial<EndpointCatalogEntry> = {}): EndpointCatalogEntry {
  const [platform, methodName] = id.split(".", 2);
  const version = methodName.match(/_v(\d+)$/)?.[1] ?? "1";
  return {
    endpoint_id: id,
    platform,
    platform_name: platform,
    platform_aliases: [platform],
    platform_detection_aliases: [],
    method_name: methodName,
    operation_id: methodName,
    method: "GET",
    path: `/api/${platform}/${methodName.replace(/_/g, "-")}/v${version}`,
    version: `v${version}`,
    title: methodName,
    title_en: methodName,
    description: "",
    description_en: "",
    tags: [],
    tags_en: [],
    order: 0,
    hidden: false,
    deprecated: false,
    recommended: false,
    highlights: [],
    highlights_en: [],
    search_aliases: [],
    use_cases: [],
    key_response_fields: [],
    endpoint_family: `${platform}.${methodName.replace(/_v\d+$/, "")}`,
    contract_status: { status: "pending" },
    params: [],
    search_tokens: [],
    ...overrides,
  };
}

function highlight(
  kind: EndpointHighlight["kind"],
  concept: string,
  aliases: string[],
  content = concept
): EndpointHighlight {
  return { type: "INFO", kind, concept, aliases, content };
}

const fixtures: EndpointCatalogEntry[] = [
  endpoint("taobao.product_detail_v1", {
    platform_name: "淘宝",
    platform_aliases: ["taobao", "淘宝", "天猫"],
    platform_detection_aliases: ["taobao", "淘宝", "天猫"],
    title: "商品详情",
    title_en: "Product detail",
    endpoint_family: "taobao.product_detail",
  }),
  endpoint("taobao.product_detail_v2", {
    platform_name: "淘宝",
    platform_aliases: ["taobao", "淘宝", "天猫"],
    platform_detection_aliases: ["taobao", "淘宝", "天猫"],
    title: "商品详情",
    title_en: "Product detail",
    recommended: true,
    endpoint_family: "taobao.product_detail",
    highlights: [highlight("CAPABILITY", "post_coupon_price", ["coupon-adjusted price", "券后价"])],
    key_response_fields: [
      {
        path: "$.data.priceAfterCoupon",
        name: "Coupon-adjusted price",
        aliases: ["券后价"],
      },
    ],
  }),
  endpoint("xiaohongshu.video_detail_v4", {
    platform_name: "小红书",
    platform_aliases: ["xiaohongshu", "小红书", "rednote"],
    platform_detection_aliases: ["xiaohongshu", "小红书", "rednote"],
    title: "视频详情",
    title_en: "Video detail",
    endpoint_family: "xiaohongshu.note_detail",
    highlights: [
      highlight("LIMITATION", "video_download", ["download video", "下载视频", "视频下载"]),
    ],
  }),
  endpoint("xiaohongshu.video_detail_v5", {
    platform_name: "小红书",
    platform_aliases: ["xiaohongshu", "小红书", "rednote"],
    platform_detection_aliases: ["xiaohongshu", "小红书", "rednote"],
    title: "视频详情",
    title_en: "Video detail",
    recommended: true,
    endpoint_family: "xiaohongshu.note_detail",
    highlights: [
      highlight("CAPABILITY", "video_download", ["download video", "下载视频", "视频下载"]),
    ],
  }),
  endpoint("xiaohongshu.note_detail_v1", {
    platform_name: "小红书",
    platform_aliases: ["xiaohongshu", "小红书", "rednote"],
    platform_detection_aliases: ["xiaohongshu", "小红书", "rednote"],
    title: "笔记详情",
    title_en: "Note detail",
    endpoint_family: "xiaohongshu.content_detail",
    highlights: [
      highlight("LIMITATION", "image_text_note_detail", ["图文笔记详情", "image note detail"]),
    ],
  }),
  endpoint("xiaohongshu.note_detail_v6", {
    platform_name: "小红书",
    platform_aliases: ["xiaohongshu", "小红书", "rednote"],
    platform_detection_aliases: ["xiaohongshu", "小红书", "rednote"],
    title: "笔记详情",
    title_en: "Note detail",
    recommended: true,
    endpoint_family: "xiaohongshu.content_detail",
    highlights: [
      highlight("CAPABILITY", "image_text_note_detail", ["图文笔记详情", "image note detail"]),
    ],
  }),
  endpoint("xiaohongshu_pgy.creator_summary_v1", {
    platform_name: "小红书蒲公英",
    platform_aliases: ["xiaohongshu_pgy", "小红书蒲公英", "蒲公英"],
    platform_detection_aliases: ["小红书蒲公英", "蒲公英"],
    title: "达人数据概览",
    title_en: "Creator data summary",
    search_aliases: ["蒲公英曝光中位数", "creator exposure median"],
    key_response_fields: [
      {
        path: "$.data.exposureMedian",
        name: "Exposure median",
        aliases: ["曝光中位数"],
      },
    ],
  }),
  endpoint("douyin.fans_portrait_v1", {
    platform_name: "抖音",
    platform_aliases: ["douyin", "抖音"],
    platform_detection_aliases: ["douyin", "抖音"],
    title: "粉丝画像",
    title_en: "Audience portrait",
    search_aliases: ["抖音粉丝画像城市分布", "audience city distribution"],
    key_response_fields: [
      {
        path: "$.data.cityDistribution",
        name: "City distribution",
        aliases: ["粉丝画像城市分布"],
      },
    ],
  }),
];

function search(query: string, endpoints = fixtures) {
  return searchEndpoints(endpoints, { query, limit: 5 }, { mode: "v2" });
}

describe("deterministic structured ranking", () => {
  it.each([
    ["淘宝券后价", "taobao.product_detail_v2"],
    ["小红书下载视频", "xiaohongshu.video_detail_v5"],
    ["小红书图文笔记详情", "xiaohongshu.note_detail_v6"],
    ["蒲公英曝光中位数", "xiaohongshu_pgy.creator_summary_v1"],
    ["抖音粉丝画像城市分布", "douyin.fans_portrait_v1"],
    ["Taobao coupon-adjusted price", "taobao.product_detail_v2"],
    ["RedNote download video", "xiaohongshu.video_detail_v5"],
    ["creator exposure median", "xiaohongshu_pgy.creator_summary_v1"],
  ])("ranks %s", (query, expected) => {
    expect(search(query).results[0]?.endpoint_id).toBe(expected);
  });

  it("never treats a LIMITATION as a positive match", () => {
    const output = search("小红书下载视频");
    expect(output.results.map((result) => result.endpoint_id)).not.toContain(
      "xiaohongshu.video_detail_v4"
    );
    expect(output.results[0].matched_capabilities?.[0]).toMatchObject({
      kind: "CAPABILITY",
      concept: "video_download",
    });
  });

  it("retrieves reviewed response fields bilingually with lower weight than key fields", () => {
    const reviewedField = endpoint("web.reviewed_field_v1", {
      title: "Reviewed payload",
      title_en: "Reviewed payload",
      response_field_descriptions: [
        {
          name: "engagementMedian",
          path: "$.data.metrics.engagementMedian",
          type: "number",
          description: "互动量中位数",
          description_en: "Engagement median",
        },
      ],
    });
    const keyField = endpoint("web.key_field_v1", {
      title: "Key payload",
      title_en: "Key payload",
      key_response_fields: [
        {
          path: "$.data.engagementMedian",
          name: "Engagement median",
          description: "互动量中位数",
          description_en: "Engagement median",
        },
      ],
    });

    const english = search("engagement median", [reviewedField]);
    expect(english.results[0]).toMatchObject({
      endpoint_id: reviewedField.endpoint_id,
      score: 95,
      matched_response_field_descriptions: [
        expect.objectContaining({ path: "$.data.metrics.engagementMedian" }),
      ],
      match_reasons: expect.arrayContaining(["response-field:$.data.metrics.engagementMedian"]),
    });
    expect(search("互动量中位数", [reviewedField]).results[0]?.endpoint_id).toBe(
      reviewedField.endpoint_id
    );

    const weighted = search("engagement median", [reviewedField, keyField]);
    expect(weighted.results.map((result) => [result.endpoint_id, result.score])).toEqual([
      [keyField.endpoint_id, 99],
      [reviewedField.endpoint_id, 95],
    ]);
  });

  it("does not index absent or empty unreviewed response field metadata", () => {
    const withoutReviewedFields = endpoint("web.unreviewed_field_v1", {
      title: "Generic payload",
      title_en: "Generic payload",
      response_field_descriptions: [],
    });
    expect(search("unreviewedSecretMetric", [withoutReviewedFields]).results).toEqual([]);
  });

  it("does not turn a specific download limitation into a generic video exclusion", () => {
    const limited = endpoint("web.video_detail_v1", {
      title: "Video detail",
      title_en: "Video detail",
      search_aliases: ["video"],
      highlights: [highlight("LIMITATION", "video_download", ["download video", "下载视频"])],
    });

    expect(search("video", [limited]).results[0]?.endpoint_id).toBe(limited.endpoint_id);
    expect(search("video", [limited]).results[0]?.relevant_limitations).toEqual([
      expect.objectContaining({ concept: "video_download" }),
    ]);
    expect(search("download video", [limited]).results).toEqual([]);
    expect(search("download a video", [limited]).results).toEqual([]);
  });

  it("treats a reviewed two-character CJK limitation alias as a conflict", () => {
    const limited = endpoint("web.caption_v1", {
      title: "字幕",
      title_en: "Captions",
      highlights: [highlight("LIMITATION", "caption", ["字幕", "captions"])],
    });

    expect(search("字幕", [limited]).results).toEqual([]);
  });

  it("does not let one-character CJK or short English aliases create conflicts", () => {
    const limited = endpoint("web.image_user_v1", {
      title: "图片用户",
      title_en: "Image user",
      search_aliases: ["图片", "user profile"],
      highlights: [highlight("LIMITATION", "short_aliases", ["图", "id"])],
    });

    expect(search("图片", [limited]).results[0]?.endpoint_id).toBe(limited.endpoint_id);
    expect(search("user profile", [limited]).results[0]?.endpoint_id).toBe(limited.endpoint_id);
  });

  it.each(["4K", "HD"])(
    "uses an exact token boundary for the reviewed short limitation alias %s",
    (alias) => {
      const limited = endpoint("web.video_quality_v1", {
        title: "Video download",
        title_en: "Video download",
        search_aliases: ["download video"],
        highlights: [highlight("LIMITATION", "video_quality", [alias])],
      });

      expect(search(`download ${alias} video`, [limited]).results).toEqual([]);
      expect(search(`download prefix${alias} video`, [limited]).results[0]?.endpoint_id).toBe(
        limited.endpoint_id
      );
    }
  );

  it("merges translated structured highlights by machine concept", () => {
    const translated = endpoint("web.video_download_v1", {
      title: "视频下载",
      title_en: "Video download",
      highlights: [highlight("CAPABILITY", "video_download", ["下载视频"], "可以下载视频。")],
      highlights_en: [
        highlight("CAPABILITY", "video_download", ["download video"], "Downloads a video."),
      ],
    });

    const output = search("download video", [translated]);
    expect(output.results[0].matched_capabilities).toHaveLength(1);
    expect(output.results[0].matched_capabilities?.[0]).toMatchObject({
      concept: "video_download",
      aliases: expect.arrayContaining(["下载视频", "download video"]),
    });
  });

  it("folds versions into alternatives, prefers recommended on a tie, and honors explicit versions", () => {
    const versions = [
      endpoint("web.render_v2", {
        title: "Rendered page",
        title_en: "Rendered page",
        search_aliases: ["render page"],
        endpoint_family: "web.render",
        recommended: true,
      }),
      endpoint("web.render_v9", {
        title: "Rendered page",
        title_en: "Rendered page",
        search_aliases: ["render page"],
        endpoint_family: "web.render",
      }),
    ];

    const normal = search("render page", versions);
    expect(normal.results).toHaveLength(1);
    expect(normal.results[0].endpoint_id).toBe("web.render_v2");
    expect(normal.results[0].alternatives?.map((item) => item.endpoint_id)).toEqual([
      "web.render_v9",
    ]);

    const explicit = search("render page v9", versions);
    expect(explicit.results[0].endpoint_id).toBe("web.render_v9");
    expect(explicit.results[0].alternatives?.[0].endpoint_id).toBe("web.render_v2");
  });

  it("keeps an exact camelCase operationId ahead of the recommended family version", () => {
    const versions = [
      endpoint("web.render_v1", {
        operation_id: "getApiRenderV1",
        endpoint_family: "web.render",
      }),
      endpoint("web.render_v2", {
        operation_id: "getApiRenderV2",
        endpoint_family: "web.render",
        recommended: true,
      }),
    ];

    const output = search("getApiRenderV1", versions);
    expect(output.results[0]).toMatchObject({
      endpoint_id: "web.render_v1",
      exact_match: true,
    });
    expect(output.results[0].alternatives?.[0].endpoint_id).toBe("web.render_v2");
  });

  it("uses the compatible recommended version within a family even when another version scores higher", () => {
    const versions = [
      endpoint("web.render_v2", {
        title: "Render",
        title_en: "Render",
        search_aliases: ["render"],
        endpoint_family: "web.render",
        recommended: true,
      }),
      endpoint("web.render_v9", {
        title: "Render page",
        title_en: "Render page",
        search_aliases: ["render page"],
        endpoint_family: "web.render",
      }),
    ];

    const output = search("render page", versions);
    expect(output.results[0].endpoint_id).toBe("web.render_v2");
    expect(output.results[0].alternatives?.[0].endpoint_id).toBe("web.render_v9");
  });

  it("re-sorts family representatives after selecting a lower-scoring recommended version", () => {
    const versions = [
      endpoint("web.render_v2", {
        title: "Render",
        title_en: "Render",
        endpoint_family: "web.render",
        recommended: true,
      }),
      endpoint("web.render_v9", {
        title: "Render page",
        title_en: "Render page",
        endpoint_family: "web.render",
      }),
      endpoint("web.page_renderer_v1", {
        title: "Page render lookup",
        title_en: "Page render lookup",
        endpoint_family: "web.page_renderer",
      }),
    ];

    const output = search("render page", versions);
    expect(output.results.map((result) => [result.endpoint_id, result.score])).toEqual([
      ["web.page_renderer_v1", 90],
      ["web.render_v2", 55],
    ]);
  });

  it("selects positive capability evidence before a generic recommended family version", () => {
    const versions = [
      endpoint("taobao.coupon_detail_v1", {
        platform_name: "淘宝",
        platform_aliases: ["taobao", "淘宝"],
        platform_detection_aliases: ["taobao", "淘宝"],
        title: "券后价详情",
        title_en: "Coupon price detail",
        endpoint_family: "taobao.coupon_detail",
        recommended: true,
      }),
      endpoint("taobao.coupon_detail_v2", {
        platform_name: "淘宝",
        platform_aliases: ["taobao", "淘宝"],
        platform_detection_aliases: ["taobao", "淘宝"],
        title: "商品详情",
        title_en: "Product detail",
        endpoint_family: "taobao.coupon_detail",
        highlights: [
          highlight("CAPABILITY", "post_coupon_price", ["coupon-adjusted price", "券后价"]),
        ],
      }),
    ];

    const output = search("淘宝券后价", versions);
    expect(output.results[0]).toMatchObject({
      endpoint_id: "taobao.coupon_detail_v2",
      matched_capabilities: [expect.objectContaining({ concept: "post_coupon_price" })],
    });
  });

  it("does not let an explicit version override a conflicting limitation", () => {
    const output = search("小红书下载视频 v4");
    expect(output.results[0].endpoint_id).toBe("xiaohongshu.video_detail_v5");
    expect(output.results.map((result) => result.endpoint_id)).not.toContain(
      "xiaohongshu.video_detail_v4"
    );
    expect(output.results[0].alternatives?.[0]).toMatchObject({
      endpoint_id: "xiaohongshu.video_detail_v4",
      compatible: false,
      compatibility: "incompatible",
    });
  });

  it("marks a family version without positive capability evidence as unknown", () => {
    const unknownVersion = endpoint("xiaohongshu.video_detail_v3", {
      platform_name: "小红书",
      platform_aliases: ["xiaohongshu", "小红书", "rednote"],
      platform_detection_aliases: ["xiaohongshu", "小红书", "rednote"],
      title: "视频详情",
      title_en: "Video detail",
      endpoint_family: "xiaohongshu.note_detail",
    });

    const output = search("小红书下载视频", [...fixtures, unknownVersion]);
    expect(output.results[0].alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint_id: "xiaohongshu.video_detail_v3",
          compatible: false,
          compatibility: "unknown",
        }),
      ])
    );
  });

  it("returns deprecated public versions for exact identifiers or explicit version queries", () => {
    const versions = [
      endpoint("web.archive_v1", {
        title: "Page archive",
        title_en: "Page archive",
        search_aliases: ["page archive"],
        endpoint_family: "web.archive",
        deprecated: true,
      }),
      endpoint("web.archive_v2", {
        title: "Page archive",
        title_en: "Page archive",
        search_aliases: ["page archive"],
        endpoint_family: "web.archive",
        recommended: true,
      }),
    ];
    const exact = search("web.archive_v1", versions);
    expect(exact.results[0].endpoint_id).toBe("web.archive_v1");
    expect(exact.results[0].deprecated).toBe(true);
    expect(exact.results[0].alternatives?.[0].endpoint_id).toBe("web.archive_v2");

    const explicit = search("page archive v1", versions);
    expect(explicit.results[0].endpoint_id).toBe("web.archive_v1");
  });

  it("penalizes matching conditions and caps confidence at medium", () => {
    const conditional = endpoint("web.historical_metrics_v1", {
      title: "Historical metrics",
      title_en: "Historical metrics",
      search_aliases: ["historical metrics"],
      highlights: [
        highlight("CONDITION", "recent_dates_only", ["recent dates"], "Recent dates only."),
      ],
    });
    const output = search("historical metrics", [conditional]);
    expect(output.results[0].score).toBe(85);
    expect(output.results[0].conditional).toBe(true);
    expect(output.confidence).toBe("medium");
  });

  it("does not return a conditional endpoint when its penalized score is below 40", () => {
    const conditional = endpoint("web.conditional_alpha_v1", {
      title: "Alpha",
      title_en: "Alpha",
      highlights: [
        highlight("CONDITION", "special_access", ["special access"], "Special access required."),
      ],
    });
    expect(search("alpha beta gamma", [conditional]).results).toEqual([]);
  });

  it.each([
    "lookup",
    "parameters",
    "application",
    "supports",
    "documented request",
    "provides access",
    "integrate workflows",
    "查询",
    "查找",
    "集成",
    "应用",
    "工作流",
  ])("does not rank universal contract boilerplate for %s", (query) => {
    const boilerplate = endpoint("web.public_record_v1", {
      title: "Public record",
      title_en: "Public record",
      description:
        "Supports public record data using the documented request parameters. Use it when an application needs public records.",
      description_en:
        "Supports public record data using the documented request parameters. Use it when an application needs public records.",
      use_cases: [{ description: "Public record lookup." }],
    });
    expect(search(query, [boilerplate]).results).toEqual([]);
  });

  it.each([
    "",
    "public data",
    "get data",
    "用于",
    "适用于",
    "数据",
    "a",
    "x",
    "v",
    "图",
    "价",
    "淘宝",
  ])("returns no V2 results for empty or non-specific intent %j", (query) => {
    expect(search(query).results).toEqual([]);
  });

  it.each([
    "",
    "public data",
    "get data",
    "用于",
    "适用于",
    "数据",
    "a",
    "x",
    "v",
    "图",
    "价",
    "淘宝",
  ])(
    "does not let legacy platform, recommended, or version bonuses create a hit for %j",
    (query) => {
      expect(searchEndpoints(fixtures, { query, limit: 5 }, { mode: "legacy" }).results).toEqual(
        []
      );
    }
  );

  it("does not index fields that are only available in selected response variants", () => {
    const variantOnly = endpoint("web.variant_payload_v1", {
      title: "Payload",
      title_en: "Payload",
      key_response_fields: [
        {
          path: "$.data.experimentalMetric",
          name: "Experimental metric",
          aliases: ["variant-only metric"],
          availability: "selected_variants",
        },
      ],
    });
    expect(search("variant-only metric", [variantOnly]).results).toEqual([]);
  });

  it("uses only reviewed detection aliases for automatic platform detection", () => {
    const twitter = endpoint("twitter.search_v1", {
      platform_aliases: ["twitter", "Twitter", "X"],
      platform_detection_aliases: ["twitter", "推特"],
      title: "Post search",
      title_en: "Post search",
      search_aliases: ["search posts"],
    });
    expect(search("X post search", [twitter]).normalized.platform).toBeUndefined();
    expect(
      searchEndpoints([twitter], { query: "post search", platform: "X" }, { mode: "v2" }).normalized
        .platform
    ).toBe("twitter");
  });

  it("preserves a canonical platform that exists only in tag metadata", () => {
    const bluesky = endpoint("bluesky.search_v1", {
      platform_name: "Bluesky",
      platform_aliases: ["bluesky"],
      platform_detection_aliases: ["蓝天社交"],
      title: "Post search",
      title_en: "Post search",
      search_aliases: ["search posts"],
    });
    const unrelated = endpoint("web.search_v1", {
      title: "Post search",
      title_en: "Post search",
      search_aliases: ["search posts"],
    });

    const output = search("蓝天社交 search posts", [bluesky, unrelated]);
    expect(output.normalized.platform).toBe("bluesky");
    expect(output.normalized.phrase).toBe("search posts");
    expect(output.results.map((result) => result.endpoint_id)).toEqual(["bluesky.search_v1"]);
  });

  it("meets the bilingual hard-regression release thresholds", () => {
    const cases = [
      ["淘宝券后价", "taobao.product_detail_v2"],
      ["小红书下载视频", "xiaohongshu.video_detail_v5"],
      ["小红书图文笔记详情", "xiaohongshu.note_detail_v6"],
      ["蒲公英曝光中位数", "xiaohongshu_pgy.creator_summary_v1"],
      ["抖音粉丝画像城市分布", "douyin.fans_portrait_v1"],
      ["Taobao coupon-adjusted price", "taobao.product_detail_v2"],
      ["RedNote download video", "xiaohongshu.video_detail_v5"],
      ["creator exposure median", "xiaohongshu_pgy.creator_summary_v1"],
    ] as const;
    const ranks = cases.map(([query, expected]) =>
      search(query).results.findIndex((result) => result.endpoint_id === expected)
    );
    const top1 = ranks.filter((rank) => rank === 0).length / ranks.length;
    const recallAt3 = ranks.filter((rank) => rank >= 0 && rank < 3).length / ranks.length;
    const mrr =
      ranks.reduce((sum, rank) => sum + (rank >= 0 ? 1 / (rank + 1) : 0), 0) / ranks.length;
    expect(top1).toBeGreaterThanOrEqual(0.95);
    expect(recallAt3).toBeGreaterThanOrEqual(0.99);
    expect(mrr).toBeGreaterThanOrEqual(0.97);
  });
});

describe("ranking feature flag compatibility", () => {
  it("keeps legacy ranking as the default and enables V2 explicitly", () => {
    expect(searchEndpoints(fixtures, { query: "淘宝券后价" }).ranking_version).toBe("legacy");
    expect(search("淘宝券后价").ranking_version).toBe("v2");
  });
});
