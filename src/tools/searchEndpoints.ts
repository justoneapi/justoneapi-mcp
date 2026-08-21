import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { authorizeScope } from "../common/runtime.js";
import { searchEndpoints as rankEndpoints } from "../search/rank.js";

export const SearchEndpointsInput = z.object({
  query: z.string().min(1).describe("Natural-language endpoint search query."),
  platform: z
    .string()
    .optional()
    .describe("Optional platform filter, e.g. douyin, xiaohongshu, 抖音."),
  limit: z.number().int().min(1).max(20).default(8).optional(),
  include_deprecated: z.boolean().default(false).optional(),
  include_hidden: z.boolean().default(false).optional(),
});

export async function searchEndpoints(
  input: z.infer<typeof SearchEndpointsInput>,
  ctx: RuntimeContext
) {
  authorizeScope(ctx, "mcp:catalog:read");
  const bundle = await ctx.catalogManager.load();
  const result = rankEndpoints(bundle.catalog.endpoints, input, {
    mode: ctx.config.searchV2Enabled ? "v2" : "legacy",
  });
  ctx.logger.info("endpoint_search", {
    release_id: bundle.meta.release_id,
    ranking_version: result.ranking_version,
    no_results: result.results.length === 0,
    confidence: result.confidence,
    candidate_count: result.results.length,
  });
  return result;
}
