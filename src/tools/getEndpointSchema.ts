import { z } from "zod";
import { authorizeScope, RuntimeContext } from "../common/runtime.js";
import { McpToolError, defaultMessage } from "../common/errors.js";
import { normalizeHighlights } from "../catalog/highlights.js";

export const GetEndpointSchemaInput = z.object({
  endpoint_id: z.string().min(1).describe("Endpoint id returned by search_endpoints."),
});

export async function getEndpointSchema(
  input: z.infer<typeof GetEndpointSchemaInput>,
  ctx: RuntimeContext
) {
  authorizeScope(ctx, "mcp:catalog:read");
  const endpoint = await ctx.catalogManager.getEndpoint(input.endpoint_id);
  if (!endpoint) {
    throw new McpToolError({
      code: "ENDPOINT_NOT_FOUND",
      message: defaultMessage("ENDPOINT_NOT_FOUND"),
    });
  }

  const result = {
    success: true,
    endpoint_id: endpoint.endpoint_id,
    platform: endpoint.platform,
    platform_name: endpoint.platform_name,
    platform_aliases: endpoint.platform_aliases,
    title: endpoint.title,
    title_en: endpoint.title_en,
    description: endpoint.description,
    description_en: endpoint.description_en,
    method: endpoint.method,
    path: endpoint.path,
    version: endpoint.version,
    deprecated: endpoint.deprecated,
    hidden: endpoint.hidden,
    recommended: endpoint.recommended,
    endpoint_family: endpoint.endpoint_family,
    search_aliases: endpoint.search_aliases ?? [],
    use_cases: endpoint.use_cases ?? [],
    highlights: normalizeHighlights(endpoint.highlights),
    highlights_en: normalizeHighlights(endpoint.highlights_en),
    params: endpoint.params.map((param) => ({
      name: param.name,
      api_name: param.api_name,
      in: param.in,
      required: param.required,
      type: param.type,
      format: param.format,
      default: param.default,
      enum: param.enum,
      description: param.description,
      description_en: param.description_en,
    })),
    example: {
      endpoint_id: endpoint.endpoint_id,
      params: Object.fromEntries(
        endpoint.params
          .filter((param) => param.required)
          .map((param) => [param.name, `<${param.type}>`])
      ),
    },
    pagination: endpoint.pagination,
  };
  return result;
}
