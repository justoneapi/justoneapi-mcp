import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { McpToolError, defaultMessage } from "../common/errors.js";
import { normalizeHighlights } from "../catalog/highlights.js";
import {
  assertVerifiedResponseContract,
  generateSyntheticExample,
  unverifiedResponseSchema,
} from "../catalog/schema.js";
import { assertSafeCatalogValue } from "../catalog/security.js";

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
      message: defaultMessage("ENDPOINT_NOT_FOUND"),
    });
  }

  const contractStatus = endpoint.contract_status ?? {
    status: "pending" as const,
    reason: "Insufficient verified response evidence",
  };
  let responseSchema = endpoint.response_schema;
  if (contractStatus.status === "verified") {
    try {
      assertVerifiedResponseContract(responseSchema);
    } catch {
      throw new McpToolError({
        code: "CATALOG_NOT_READY",
        message: defaultMessage("CATALOG_NOT_READY"),
      });
    }
  } else {
    // Older cached catalogs may predate contract-status enforcement. Never
    // expose their typed response claims until the contract is verified.
    responseSchema = unverifiedResponseSchema();
  }
  // Recompute from the effective projected schema instead of trusting a cached
  // example produced by an older catalog generator.
  const responseExample = generateSyntheticExample(responseSchema);
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
    key_response_fields: endpoint.key_response_fields ?? [],
    response_field_descriptions: endpoint.response_field_descriptions ?? [],
    contract_status: contractStatus,
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
    response_schema: responseSchema,
    response_example: responseExample,
    response_example_synthetic: responseExample !== undefined,
  };
  assertSafeCatalogValue(result, "get_endpoint_schema result", ctx.config.privateCatalogTerms);
  return result;
}
