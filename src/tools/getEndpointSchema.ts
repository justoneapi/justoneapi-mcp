import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { McpToolError } from "../common/errors.js";

export const GetEndpointSchemaInput = z.object({
  endpoint_id: z.string().min(1).describe("Endpoint id returned by search_endpoints."),
});

export async function getEndpointSchema(
  input: z.infer<typeof GetEndpointSchemaInput>,
  ctx: RuntimeContext
) {
  if (!ctx.getToken()) {
    throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
  }
  const endpoint = await ctx.catalogManager.getEndpoint(input.endpoint_id);
  if (!endpoint) {
    throw new McpToolError({
      code: "ENDPOINT_NOT_FOUND",
      message: `Unknown endpoint_id: ${input.endpoint_id}`,
    });
  }

  return {
    success: true,
    endpoint_id: endpoint.endpoint_id,
    platform: endpoint.platform,
    title: endpoint.title,
    title_en: endpoint.title_en,
    description: endpoint.description,
    description_en: endpoint.description_en,
    method: endpoint.method,
    path: endpoint.path,
    version: endpoint.version,
    deprecated: endpoint.deprecated,
    hidden: endpoint.hidden,
    highlights: endpoint.highlights,
    highlights_en: endpoint.highlights_en,
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
}
