import { authorizeScope, RuntimeContext } from "../common/runtime.js";
import {
  PLATFORM_DICTIONARY,
  platformAliases,
  platformDisplayName,
} from "../search/dictionaries/platforms.js";

export async function listPlatforms(ctx: RuntimeContext) {
  authorizeScope(ctx, "mcp:catalog:read");
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
      .map(([id, endpoint_count]) => {
        const endpoint = bundle.catalog.endpoints.find((item) => item.platform === id);
        return {
          id,
          name: endpoint?.platform_name ?? platformDisplayName(id),
          description: endpoint?.platform_description,
          description_en: endpoint?.platform_description_en,
          aliases: (endpoint?.platform_aliases ?? platformAliases(id)).filter(
            (alias) => alias !== id && alias !== PLATFORM_DICTIONARY[id]?.name
          ),
          detection_aliases: endpoint?.platform_detection_aliases ?? [],
          endpoint_count,
        };
      }),
  };
}
