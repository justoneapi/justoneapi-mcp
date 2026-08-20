import { createHash } from "node:crypto";
import {
  CatalogBundle,
  CatalogSafetyContext,
  EndpointCatalogEntry,
  EndpointHighlight,
  EndpointPagination,
  EndpointParam,
  EndpointUseCase,
  JsonValue,
} from "./types.js";
import { normalizePlatform, splitWords, toSnakeCase, unique } from "./stringUtils.js";
import { platformAliases, platformDisplayName } from "../search/dictionaries/platforms.js";
import { DOMAIN_TERMS, STOPWORDS } from "../search/dictionaries/domainTerms.js";
import { normalizeHighlights } from "./highlights.js";
import {
  assertNoCredentialParameterValues,
  assertSafeCatalogValue,
  isAllowedLegacyPaginationParameter,
  isCredentialParameterName,
  isLegacyPublicPaginationOperation,
} from "./security.js";
import { catalogSafetyContext } from "./release.js";

type OpenApiSchema = {
  type?: string;
  format?: string;
  description?: string;
  default?: JsonValue;
  enum?: JsonValue[];
  const?: JsonValue;
  example?: JsonValue;
  examples?: JsonValue[];
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
  deprecated?: boolean;
  "x-order"?: string | number;
  "x-api-version"?: string;
  "x-docs-hidden"?: boolean;
  "x-recommended"?: boolean;
  "x-highlights"?: unknown[];
  "x-search-aliases"?: unknown;
  "x-use-cases"?: unknown;
  "x-endpoint-family"?: string;
};

type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  tags?: Array<{
    name?: string;
    description?: string;
    "x-platform-id"?: string;
    "x-platform-aliases"?: unknown;
    "x-platform-detection-aliases"?: unknown;
    "x-search-aliases"?: unknown;
    "x-aliases"?: unknown;
  }>;
  [key: string]: unknown;
};

type PlatformMetadata = {
  name?: string;
  description?: string;
  descriptionEn?: string;
  aliases: string[];
  detectionAliases: string[];
};

export type BuildCatalogOptions = {
  openapi: OpenApiDocument;
  openapiZh?: OpenApiDocument | null;
  openapiUrl: string;
  openapiZhUrl: string;
  openapiText: string;
  openapiZhText?: string | null;
  generatedAt?: string;
  requireLocalizedReleaseId?: boolean;
};

const VERSION_RE = /^v\d+$/i;
export const CATALOG_GENERATOR_VERSION = "6";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function buildCatalogBundle(options: BuildCatalogOptions): CatalogBundle {
  assertLocalizedOpenApiAlignment(
    options.openapi,
    options.openapiZh,
    options.openapiZhText,
    options.requireLocalizedReleaseId ?? false
  );
  const endpoints: EndpointCatalogEntry[] = [];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const openapiHash = sha256(options.openapiText);
  const openapiZhHash = options.openapiZhText ? sha256(options.openapiZhText) : undefined;
  const zhOps = operationMap(options.openapiZh ?? undefined);
  const platformMetadata = buildPlatformMetadata(options.openapi, options.openapiZh ?? undefined);

  for (const [path, pathItem] of Object.entries(options.openapi.paths ?? {})) {
    for (const [methodRaw, operation] of Object.entries(pathItem)) {
      if (methodRaw.startsWith("x-")) continue;
      const method = methodRaw.toUpperCase() as EndpointCatalogEntry["method"];
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
      if (operation["x-docs-hidden"]) continue;

      const parsed = parsePath(path, operation);
      if (!parsed) continue;

      const zhOperation = zhOps.get(operationKey(path, methodRaw, operation));
      endpoints.push(
        buildEndpoint(
          path,
          method,
          parsed,
          operation,
          zhOperation,
          platformMetadata.get(parsed.platform) ??
            operation.tags
              ?.map((tag) => platformMetadata.get(`tag:${tag.toLowerCase()}`))
              .find((metadata): metadata is PlatformMetadata => Boolean(metadata))
        )
      );
    }
  }

  endpoints.sort((a, b) => a.order - b.order || a.endpoint_id.localeCompare(b.endpoint_id));
  assertUniqueEndpointIds(endpoints);
  assertUniqueRecommendedVersions(endpoints);
  const semanticHash = sha256(JSON.stringify(endpoints));
  const security = catalogSafetyContext();
  const bundle: CatalogBundle = {
    catalog: { endpoints },
    meta: {
      release_id: catalogReleaseId(generatedAt, openapiHash, openapiZhHash, semanticHash, security),
      generator_version: CATALOG_GENERATOR_VERSION,
      generated_at: generatedAt,
      endpoint_count: endpoints.length,
      localization_available: Boolean(options.openapiZhText),
      security,
      source: {
        openapi_url: options.openapiUrl,
        openapi_zh_url: options.openapiZhUrl,
        openapi_sha256: openapiHash,
        openapi_zh_sha256: openapiZhHash,
      },
    },
  };
  assertSafeCatalogValue(bundle, "catalog bundle");
  return bundle;
}

function assertLocalizedOpenApiAlignment(
  openapi: OpenApiDocument,
  openapiZh: OpenApiDocument | null | undefined,
  openapiZhText: string | null | undefined,
  requireReleaseId: boolean
): void {
  if (!openapiZh && !openapiZhText) return;
  if (!openapiZh || !openapiZhText) {
    throw new Error("English and Chinese OpenAPI documents are both required for localization");
  }

  const englishRelease = cleanOptionalString(openapi["x-openapi-release-id"]);
  const chineseRelease = cleanOptionalString(openapiZh["x-openapi-release-id"]);
  if (requireReleaseId && (!englishRelease || !chineseRelease)) {
    throw new Error("English and Chinese OpenAPI release identifiers are required");
  }
  if (englishRelease || chineseRelease) {
    if (!englishRelease || !chineseRelease || englishRelease !== chineseRelease) {
      throw new Error("English and Chinese OpenAPI release identifiers do not match");
    }
  }

  const englishOperations = localizedOperationKeys(openapi);
  const chineseOperations = localizedOperationKeys(openapiZh);
  if (
    englishOperations.length !== chineseOperations.length ||
    englishOperations.some((key, index) => key !== chineseOperations[index])
  ) {
    throw new Error("English and Chinese OpenAPI operation sets do not match");
  }
}

function localizedOperationKeys(openapi: OpenApiDocument): string[] {
  const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  const keys: string[] = [];
  for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase())) continue;
      keys.push(`${method.toLowerCase()} ${path} ${operation.operationId ?? ""}`);
    }
  }
  return keys.sort();
}

function catalogReleaseId(
  generatedAt: string,
  openapiHash: string,
  openapiZhHash: string | undefined,
  semanticHash: string,
  security: CatalogSafetyContext | undefined
): string {
  const timestamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const contentHash = sha256(
    `${CATALOG_GENERATOR_VERSION}:${openapiHash}:${openapiZhHash ?? ""}:${semanticHash}:${JSON.stringify(security ?? null)}`
  );
  return `catalog-${timestamp}-${contentHash.slice(0, 12)}`;
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
  zhOperation: OpenApiOperation | undefined,
  platformMetadata?: PlatformMetadata
): EndpointCatalogEntry {
  const params = buildParams(path, method, operation, zhOperation);
  const highlightsEn = normalizeHighlights(operation["x-highlights"]);
  const highlights = normalizeHighlights(
    zhOperation?.["x-highlights"] ?? operation["x-highlights"]
  );
  if (zhOperation) assertLocalizedHighlightAlignment(highlightsEn, highlights);
  const endpoint: EndpointCatalogEntry = {
    endpoint_id: `${parsed.platform}.${parsed.methodName}`,
    platform: parsed.platform,
    platform_name: platformMetadata?.name ?? platformDisplayName(parsed.platform),
    platform_description: platformMetadata?.description ?? platformMetadata?.descriptionEn,
    platform_description_en: platformMetadata?.descriptionEn,
    platform_aliases: unique([
      ...platformAliases(parsed.platform),
      ...(platformMetadata?.aliases ?? []),
      ...(platformMetadata?.detectionAliases ?? []),
    ]),
    platform_detection_aliases: platformMetadata?.detectionAliases ?? [],
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
    highlights,
    highlights_en: highlightsEn,
    search_aliases: unique([
      ...normalizeStringArray(operation["x-search-aliases"]),
      ...normalizeStringArray(zhOperation?.["x-search-aliases"]),
    ]),
    use_cases: mergeLocalizedUseCases(operation["x-use-cases"], zhOperation?.["x-use-cases"]),
    endpoint_family:
      cleanOptionalString(operation["x-endpoint-family"]) ?? inferEndpointFamily(parsed),
    params,
    search_tokens: [],
  };
  endpoint.search_tokens = buildSearchTokens(endpoint);
  endpoint.pagination = inferPagination(params);
  assertSafeCatalogValue(endpoint, "public endpoint");
  return endpoint;
}

function assertLocalizedHighlightAlignment(
  english: EndpointHighlight[],
  chinese: EndpointHighlight[]
): void {
  if (english.length !== chinese.length) {
    throw new Error("English and Chinese OpenAPI highlight structures do not match");
  }
  for (let index = 0; index < english.length; index += 1) {
    const left = english[index];
    const right = chinese[index];
    if (
      left.type !== right.type ||
      left.kind !== right.kind ||
      left.concept !== right.concept ||
      JSON.stringify(left.aliases ?? []) !== JSON.stringify(right.aliases ?? []) ||
      JSON.stringify(left.fieldPaths ?? []) !== JSON.stringify(right.fieldPaths ?? [])
    ) {
      throw new Error("English and Chinese OpenAPI highlight machine metadata do not match");
    }
  }
}

function buildParams(
  path: string,
  method: EndpointCatalogEntry["method"],
  operation: OpenApiOperation,
  zhOperation?: OpenApiOperation
): EndpointParam[] {
  const params: EndpointParam[] = [];
  const operationIdentity = { path, method };
  const zhParamDescriptions = new Map<string, string>();
  for (const param of zhOperation?.parameters ?? []) {
    zhParamDescriptions.set(param.name, param.description ?? "");
  }

  for (const param of operation.parameters ?? []) {
    if (isCredentialParameterName(param.name)) {
      if (
        isAllowedLegacyPaginationParameter(operationIdentity, {
          name: param.name,
          in: param.in,
          required: Boolean(param.required),
          type: param.schema?.type,
          default: param.schema?.default,
          enum: param.schema?.enum,
          const: param.schema?.const,
          example: param.schema?.example,
          examples: param.schema?.examples,
          description: param.description,
        })
      ) {
        params.push(fromOpenApiParam(param, zhParamDescriptions.get(param.name)));
        continue;
      }
      assertValidLegacyPaginationException(operationIdentity, param.name);
      assertNoCredentialParameterValues(
        param.name,
        param.schema as Record<string, unknown> | undefined,
        `parameter ${param.name}`
      );
      continue;
    }
    params.push(fromOpenApiParam(param, zhParamDescriptions.get(param.name)));
  }

  const bodySchemas = requestBodySchemas(operation, zhOperation);
  if (bodySchemas) {
    const [schema, zhSchema] = bodySchemas;
    const required = new Set(schema.required ?? []);
    for (const [apiName, property] of Object.entries(schema.properties ?? {})) {
      if (isCredentialParameterName(apiName)) {
        if (
          isAllowedLegacyPaginationParameter(operationIdentity, {
            name: apiName,
            in: "body",
            required: required.has(apiName),
            type: property.type,
            default: property.default,
            enum: property.enum,
            const: property.const,
            example: property.example,
            examples: property.examples,
            description: property.description,
          })
        ) {
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
          continue;
        }
        assertValidLegacyPaginationException(operationIdentity, apiName);
        assertNoCredentialParameterValues(
          apiName,
          property as Record<string, unknown>,
          `request body parameter ${apiName}`
        );
        continue;
      }
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

  return dedupeParams(params, requestContentType(operation));
}

function assertValidLegacyPaginationException(
  operation: { path: string; method: string },
  parameterName: string
): void {
  if (parameterName === "cookies_buffer" && isLegacyPublicPaginationOperation(operation)) {
    throw new Error("Invalid legacy public pagination parameter contract");
  }
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

function buildPlatformMetadata(
  openapi: OpenApiDocument,
  openapiZh?: OpenApiDocument
): Map<string, PlatformMetadata> {
  const result = new Map<string, PlatformMetadata>();
  const zhById = new Map<string, NonNullable<OpenApiDocument["tags"]>[number]>();
  for (const tag of openapiZh?.tags ?? []) {
    const id = cleanOptionalString(tag["x-platform-id"]) ?? normalizePlatform(tag.name ?? "");
    if (id) zhById.set(id, tag);
  }
  for (const tag of openapi.tags ?? []) {
    const id = cleanOptionalString(tag["x-platform-id"]) ?? normalizePlatform(tag.name ?? "");
    if (!id) continue;
    const zhTag = zhById.get(id);
    result.set(id, {
      name: cleanOptionalString(zhTag?.name) ?? cleanOptionalString(tag.name),
      description: cleanOptionalString(zhTag?.description) ?? cleanOptionalString(tag.description),
      descriptionEn: cleanOptionalString(tag.description),
      aliases: unique([
        ...normalizeStringArray(tag["x-search-aliases"]),
        ...normalizeStringArray(tag["x-aliases"]),
        ...normalizeStringArray(tag["x-platform-aliases"]),
        ...normalizeStringArray(zhTag?.["x-search-aliases"]),
        ...normalizeStringArray(zhTag?.["x-aliases"]),
        ...normalizeStringArray(zhTag?.["x-platform-aliases"]),
      ]),
      detectionAliases: unique([
        ...normalizeStringArray(tag["x-platform-detection-aliases"]),
        ...normalizeStringArray(zhTag?.["x-platform-detection-aliases"]),
      ]),
    });
    if (tag.name) result.set(`tag:${tag.name.toLowerCase()}`, result.get(id)!);
  }
  return result;
}

function normalizeUseCases(value: unknown): EndpointUseCase[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ description: item.trim() }];
    if (!isObject(item)) return [];
    const description = cleanOptionalString(item.description) ?? cleanOptionalString(item.content);
    const title = cleanOptionalString(item.title) ?? cleanOptionalString(item.name);
    const id = cleanOptionalString(item.id);
    if (!description && !title && !id) return [];
    const normalized: EndpointUseCase = {
      id,
      title,
      description,
      aliases: normalizeStringArray(item.aliases),
    };
    if (!normalized.aliases?.length) delete normalized.aliases;
    return [normalized];
  });
}

function mergeLocalizedUseCases(englishValue: unknown, chineseValue: unknown): EndpointUseCase[] {
  const english = normalizeUseCases(englishValue);
  if (chineseValue === undefined) return english;
  const chinese = normalizeUseCases(chineseValue);
  if (english.length !== chinese.length) {
    throw new Error("English and Chinese OpenAPI use-case structures do not match");
  }
  const localizedById = new Map(
    chinese.filter((item) => item.id).map((item) => [item.id!, item] as const)
  );
  const consumed = new Set<EndpointUseCase>();
  const merged = english.map((item, index) => {
    const localized = item.id ? localizedById.get(item.id) : chinese[index];
    if (!localized || (item.id && localized.id !== item.id) || consumed.has(localized)) {
      throw new Error("English and Chinese OpenAPI use-case identifiers do not match");
    }
    consumed.add(localized);
    return compactObject<EndpointUseCase>({
      id: item.id,
      title: localized.title ?? item.title,
      title_en: item.title,
      description: localized.description ?? item.description,
      description_en: item.description,
      aliases: unique([...(item.aliases ?? []), ...(localized.aliases ?? [])]),
    });
  });
  if (consumed.size !== chinese.length) {
    throw new Error("English and Chinese OpenAPI use-case structures do not match");
  }
  return merged;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && (!Array.isArray(item) || item.length > 0)
    )
  ) as T;
}

function inferEndpointFamily(parsed: { platform: string; methodName: string }): string {
  const methodFamily = parsed.methodName.replace(/_v\d+$/i, "");
  return `${parsed.platform}_${methodFamily}`.replace(/_+/g, "_");
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dedupeParams(params: EndpointParam[], contentType?: string): EndpointParam[] {
  const formBodyNames =
    contentType === "application/x-www-form-urlencoded"
      ? new Set(params.filter((param) => param.in === "body").map((param) => param.api_name))
      : new Set<string>();
  const seen = new Set<string>();
  const result: EndpointParam[] = [];
  for (const param of params) {
    // springdoc may emit the same form field both as a query parameter and in
    // the form requestBody. MCP sends form endpoints in the body, so retain the
    // body representation and avoid duplicate required-parameter checks.
    if (param.in === "query" && formBodyNames.has(param.api_name)) continue;
    const key = param.api_name;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(param);
  }
  return result;
}

function buildSearchTokens(endpoint: EndpointCatalogEntry): string[] {
  const capabilityHighlights = [
    ...normalizeHighlights(endpoint.highlights),
    ...normalizeHighlights(endpoint.highlights_en),
  ].filter((highlight) => highlight.kind === "CAPABILITY");
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
    ...(endpoint.search_aliases ?? []),
    ...(endpoint.use_cases ?? []).flatMap((useCase) => [
      useCase.id ?? "",
      useCase.title ?? "",
      useCase.title_en ?? "",
      useCase.description ?? "",
      useCase.description_en ?? "",
      ...(useCase.aliases ?? []),
    ]),
    ...capabilityHighlights.flatMap((highlight) => [
      highlight.concept ?? "",
      highlight.title ?? "",
      highlight.content,
      ...(highlight.aliases ?? []),
      ...(highlight.fieldPaths ?? []),
    ]),
    ...endpoint.params.flatMap((param) => [
      param.name,
      param.api_name,
      param.description,
      param.description_en,
    ]),
    ...Object.entries(DOMAIN_TERMS).flatMap(([canonical, aliases]) => {
      const matchedAliases = aliases.filter((alias) =>
        endpointText(endpoint).includes(alias.toLowerCase())
      );
      return matchedAliases.length || endpointText(endpoint).includes(canonical)
        ? [canonical, ...matchedAliases]
        : [];
    }),
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
    ...(endpoint.search_aliases ?? []),
    ...(endpoint.use_cases ?? []).flatMap((useCase) => [
      useCase.title ?? "",
      useCase.title_en ?? "",
      useCase.description ?? "",
      useCase.description_en ?? "",
      ...(useCase.aliases ?? []),
    ]),
    ...[...normalizeHighlights(endpoint.highlights), ...normalizeHighlights(endpoint.highlights_en)]
      .filter((highlight) => highlight.kind === "CAPABILITY")
      .flatMap((highlight) => [
        highlight.concept ?? "",
        highlight.title ?? "",
        highlight.content,
        ...(highlight.aliases ?? []),
      ]),
  ]
    .join(" ")
    .toLowerCase();
}

function splitSearchValue(value: string): string[] {
  const normalized = value.toLowerCase();
  const asciiWords = splitWords(normalized);
  const cjkChunks = normalized.match(/[\u4e00-\u9fff]{1,12}/g) ?? [];
  return [...asciiWords, ...cjkChunks, normalized.trim()].filter(
    (token) => Boolean(token) && !STOPWORDS.has(token)
  );
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
    "cookies_buffer",
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

function assertUniqueRecommendedVersions(endpoints: EndpointCatalogEntry[]) {
  const recommendedByFamily = new Map<string, string>();
  for (const endpoint of endpoints) {
    if (!endpoint.recommended) continue;
    const family = endpoint.endpoint_family ?? endpoint.endpoint_id;
    const existing = recommendedByFamily.get(family);
    if (existing) {
      throw new Error(
        `Endpoint family ${family} has multiple recommended versions: ${existing}, ${endpoint.endpoint_id}`
      );
    }
    recommendedByFamily.set(family, endpoint.endpoint_id);
  }
}
