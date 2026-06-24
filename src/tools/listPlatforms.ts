import { RuntimeContext } from "../common/runtime.js";
import { McpToolError } from "../common/errors.js";
import {
  PLATFORM_DICTIONARY,
  platformAliases,
  platformDisplayName,
} from "../search/dictionaries/platforms.js";

export async function listPlatforms(ctx: RuntimeContext) {
  if (!ctx.getToken()) {
    throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
  }
  const bundle = await ctx.catalogManager.load();
  const counts = new Map<string, number>();
  for (const endpoint of bundle.catalog.endpoints) {
    if (endpoint.hidden || endpoint.deprecated) continue;
    counts.set(endpoint.platform, (counts.get(endpoint.platform) ?? 0) + 1);
  }

  return {
    success: true,
    endpoint_count: bundle.meta.endpoint_count,
    platforms: [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, endpoint_count]) => ({
        id,
        name: platformDisplayName(id),
        aliases: platformAliases(id).filter(
          (alias) => alias !== id && alias !== PLATFORM_DICTIONARY[id]?.name
        ),
        endpoint_count,
      })),
  };
}
