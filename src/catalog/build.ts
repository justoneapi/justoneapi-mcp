import { createHash } from "node:crypto";
import {
  CatalogBundle,
  EndpointCatalogEntry,
  EndpointPagination,
  EndpointParam,
  JsonValue,
} from "./types.js";
import { normalizePlatform, splitWords, toSnakeCase, unique } from "./stringUtils.js";
import { platformAliases, platformDisplayName } from "../search/dictionaries/platforms.js";
import { DOMAIN_TERMS } from "../search/dictionaries/domainTerms.js";

type OpenApiSchema = {
  type?: string;
  format?: string;
  description?: string;
  default?: JsonValue;
  enum?: JsonValue[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
};

type OpenApiParameter = {
  name: string;
  in: "query" | "path" | "header";
  description?: string;
  required?: boolean;
  schema?: OpenApiSchema;
};

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: unknown;
  deprecated?: boolean;
  "x-order"?: string | number;
  "x-api-version"?: string;
  "x-docs-hidden"?: boolean;
  "x-recommended"?: boolean;
  "x-highlights"?: Array<{ type?: string; content?: string } | string>;
};

type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
};

export type BuildCatalogOptions = {
  openapi: OpenApiDocument;
  openapiZh?: OpenApiDocument | null;
  openapiUrl: string;
  openapiZhUrl: string;
  openapiText: string;
  openapiZhText?: string | null;
  generatedAt?: string;
};

const VERSION_RE = /^v\d+$/i;

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildCatalogBundle(options: BuildCatalogOptions): CatalogBundle {
  const endpoints: EndpointCatalogEntry[] = [];
  const zhOps = operationMap(options.openapiZh ?? undefined);

  for (const [path, pathItem] of Object.entries(options.openapi.paths ?? {})) {
    for (const [methodRaw, operation] of Object.entries(pathItem)) {
      if (methodRaw.startsWith("x-")) continue;
      const method = methodRaw.toUpperCase() as EndpointCatalogEntry["method"];
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;

      const parsed = parsePath(path, operation);
      if (!parsed) continue;

      const zhOperation = zhOps.get(operationKey(path, methodRaw, operation));
      endpoints.push(buildEndpoint(path, method, parsed, operation, zhOperation));
    }
  }

  endpoints.sort((a, b) => a.order - b.order || a.endpoint_id.localeCompare(b.endpoint_id));
  assertUniqueEndpointIds(endpoints);

  return {
    catalog: { endpoints },
    meta: {
      generated_at: options.generatedAt ?? new Date().toISOString(),
      endpoint_count: endpoints.length,
      localization_available: Boolean(options.openapiZhText),
      source: {
        openapi_url: options.openapiUrl,
        openapi_zh_url: options.openapiZhUrl,
        openapi_sha256: sha256(options.openapiText),
        openapi_zh_sha256: options.openapiZhText ? sha256(options.openapiZhText) : undefined,
      },
    },
  };
}

function operationMap(doc: OpenApiDocument | undefined): Map<string, OpenApiOperation> {
  const map = new Map<string, OpenApiOperation>();
  for (const [path, pathItem] of Object.entries(doc?.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (method.startsWith("x-")) continue;
      map.set(operationKey(path, method, operation), operation);
    }
  }
  return map;
}

function operationKey(path: string, method: string, operation: OpenApiOperation): string {
  return `${method.toLowerCase()} ${operation.operationId ?? path}`;
}

function parsePath(
  path: string,
  operation: OpenApiOperation
): { platform: string; methodName: string; version: string } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts.length < 3) return null;

  const versionFromPath = parts.at(-1);
  const version =
    versionFromPath && VERSION_RE.test(versionFromPath)
      ? versionFromPath.toLowerCase()
      : (operation["x-api-version"] ?? "v1").toLowerCase();
  const actionEnd = VERSION_RE.test(parts.at(-1) ?? "") ? parts.length - 1 : parts.length;
  const platform = normalizePlatform(parts[1]);
  const actionSegments = parts.slice(2, actionEnd);
  const action = actionSegments.length ? actionSegments.map(toSnakeCase).join("_") : platform;
  const methodName = `${action}_${version}`.replace(/_+/g, "_");

  return { platform, methodName, version };
}

function buildEndpoint(
  path: string,
  method: EndpointCatalogEntry["method"],
  parsed: { platform: string; methodName: string; version: string },
  operation: OpenApiOperation,
  zhOperation?: OpenApiOperation
): EndpointCatalogEntry {
  const params = buildParams(operation, zhOperation);
  const endpoint: EndpointCatalogEntry = {
    endpoint_id: `${parsed.platform}.${parsed.methodName}`,
    platform: parsed.platform,
    platform_name: platformDisplayName(parsed.platform),
    platform_aliases: platformAliases(parsed.platform),
    method_name: parsed.methodName,
    operation_id: operation.operationId ?? `${method.toLowerCase()} ${path}`,
    method,
    path,
    version: parsed.version,
    title: zhOperation?.summary || operation.summary || parsed.methodName,
    title_en: operation.summary || parsed.methodName,
    description: zhOperation?.description || operation.description || "",
    description_en: operation.description || "",
    tags: zhOperation?.tags ?? operation.tags ?? [],
    tags_en: operation.tags ?? [],
    order: Number(operation["x-order"] ?? 0),
    hidden: Boolean(operation["x-docs-hidden"]),
    deprecated: Boolean(operation.deprecated),
    recommended: Boolean(operation["x-recommended"]),
    content_type: requestContentType(operation),
    highlights: normalizeHighlights(zhOperation?.["x-highlights"]),
    highlights_en: normalizeHighlights(operation["x-highlights"]),
    params,
    search_tokens: [],
  };
  endpoint.search_tokens = buildSearchTokens(endpoint);
  endpoint.pagination = inferPagination(params);
  return endpoint;
}

function buildParams(operation: OpenApiOperation, zhOperation?: OpenApiOperation): EndpointParam[] {
  const params: EndpointParam[] = [];
  const zhParamDescriptions = new Map<string, string>();
  for (const param of zhOperation?.parameters ?? []) {
    zhParamDescriptions.set(param.name, param.description ?? "");
  }

  for (const param of operation.parameters ?? []) {
    if (param.name === "token") continue;
    params.push(fromOpenApiParam(param, zhParamDescriptions.get(param.name)));
  }

  const bodySchemas = requestBodySchemas(operation, zhOperation);
  if (bodySchemas) {
    const [schema, zhSchema] = bodySchemas;
    const required = new Set(schema.required ?? []);
    for (const [apiName, property] of Object.entries(schema.properties ?? {})) {
      if (apiName === "token") continue;
      params.push(
        fromSchemaParam({
          apiName,
          location: "body",
          required: required.has(apiName),
          schema: property,
          description: zhSchema?.properties?.[apiName]?.description,
          descriptionEn: property.description,
        })
      );
    }
  }

  return dedupeParams(params);
}

function fromOpenApiParam(param: OpenApiParameter, descriptionZh?: string): EndpointParam {
  return fromSchemaParam({
    apiName: param.name,
    location: param.in,
    required: Boolean(param.required),
    schema: param.schema ?? {},
    description: descriptionZh,
    descriptionEn: param.description,
  });
}

function fromSchemaParam(input: {
  apiName: string;
  location: EndpointParam["in"];
  required: boolean;
  schema: OpenApiSchema;
  description?: string;
  descriptionEn?: string;
}): EndpointParam {
  return {
    name: toSnakeCase(input.apiName),
    api_name: input.apiName,
    in: input.location,
    required: input.required,
    type: input.schema.type ?? "string",
    format: input.schema.format,
    default: input.schema.default,
    enum: input.schema.enum,
    nullable: input.schema.nullable,
    minimum: input.schema.minimum,
    maximum: input.schema.maximum,
    min_length: input.schema.minLength,
    max_length: input.schema.maxLength,
    description: input.description || input.descriptionEn || "",
    description_en: input.descriptionEn || "",
  };
}

function requestBodySchemas(
  operation: OpenApiOperation,
  zhOperation?: OpenApiOperation
): [OpenApiSchema, OpenApiSchema | undefined] | null {
  const contentType = requestContentType(operation);
  if (!contentType) return null;
  const schema = operation.requestBody?.content?.[contentType]?.schema;
  const zhSchema = zhOperation?.requestBody?.content?.[contentType]?.schema;
  return schema ? [schema, zhSchema] : null;
}

function requestContentType(operation: OpenApiOperation): string | undefined {
  const content = operation.requestBody?.content;
  if (!content) return undefined;
  if (content["application/x-www-form-urlencoded"]) return "application/x-www-form-urlencoded";
  if (content["application/json"]) return "application/json";
  return Object.keys(content)[0];
}

function normalizeHighlights(highlights: OpenApiOperation["x-highlights"]): string[] {
  return (highlights ?? [])
    .map((item) => (typeof item === "string" ? item : (item.content ?? "")))
    .filter(Boolean);
}

function dedupeParams(params: EndpointParam[]): EndpointParam[] {
  const seen = new Set<string>();
  const result: EndpointParam[] = [];
  for (const param of params) {
    const key = `${param.in}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(param);
  }
  return result;
}

function buildSearchTokens(endpoint: EndpointCatalogEntry): string[] {
  const values = [
    endpoint.endpoint_id,
    endpoint.platform,
    endpoint.platform_name,
    ...endpoint.platform_aliases,
    endpoint.method_name,
    endpoint.operation_id,
    endpoint.path,
    endpoint.title,
    endpoint.title_en,
    endpoint.description,
    endpoint.description_en,
    ...endpoint.tags,
    ...endpoint.tags_en,
    ...endpoint.params.flatMap((param) => [
      param.name,
      param.api_name,
      param.description,
      param.description_en,
    ]),
    ...Object.entries(DOMAIN_TERMS).flatMap(([canonical, aliases]) => [
      canonical,
      ...aliases.filter((alias) => endpointText(endpoint).includes(alias.toLowerCase())),
    ]),
  ];

  return unique(values.flatMap((value) => splitSearchValue(value)));
}

function endpointText(endpoint: EndpointCatalogEntry): string {
  return [
    endpoint.endpoint_id,
    endpoint.path,
    endpoint.title,
    endpoint.title_en,
    endpoint.description,
    endpoint.description_en,
  ]
    .join(" ")
    .toLowerCase();
}

function splitSearchValue(value: string): string[] {
  const normalized = value.toLowerCase();
  const asciiWords = splitWords(normalized);
  const cjkChunks = normalized.match(/[\u4e00-\u9fff]{1,12}/g) ?? [];
  return [...asciiWords, ...cjkChunks, normalized.trim()].filter(Boolean);
}

function inferPagination(params: EndpointParam[]): EndpointPagination | undefined {
  const names = new Set(params.map((p) => p.name));
  const matched = [
    "next_cursor",
    "cursor",
    "page",
    "page_no",
    "page_num",
    "current_page",
    "offset",
    "limit",
    "size",
    "search_id",
    "buffer",
    "last_buffer",
  ].filter((name) => names.has(name));

  if (!matched.length) return undefined;
  if (matched.some((name) => name.includes("cursor") || name.includes("buffer"))) {
    return { type: matched.length > 1 ? "compound" : "cursor", params: matched };
  }
  if (matched.some((name) => name.includes("page"))) {
    return { type: matched.length > 1 ? "compound" : "page", params: matched };
  }
  if (matched.includes("offset")) {
    return { type: matched.length > 1 ? "compound" : "offset", params: matched };
  }
  return { type: "unknown", params: matched };
}

function assertUniqueEndpointIds(endpoints: EndpointCatalogEntry[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.endpoint_id)) duplicates.push(endpoint.endpoint_id);
    seen.add(endpoint.endpoint_id);
  }
  if (duplicates.length) {
    throw new Error(`Duplicate endpoint_id values: ${duplicates.join(", ")}`);
  }
}
