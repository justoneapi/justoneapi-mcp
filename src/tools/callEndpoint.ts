import { z } from "zod";
import { EndpointCatalogEntry, EndpointParam } from "../catalog/types.js";
import {
  McpToolError,
  defaultMessage,
  errorResult,
  mapUpstreamCode,
  validationError,
} from "../common/errors.js";
import { inferNextStep } from "../common/pagination.js";
import {
  authorizeScope,
  resolveUpstreamCredential,
  RuntimeContext,
  runtimeTokenHash,
  type UpstreamCredential,
} from "../common/runtime.js";

export const CallEndpointInput = z.object({
  endpoint_id: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}).optional(),
});

type UpstreamPayload = {
  code?: number;
  message?: string | null;
  data?: unknown;
  [key: string]: unknown;
};

export async function callEndpoint(input: z.infer<typeof CallEndpointInput>, ctx: RuntimeContext) {
  authorizeScope(ctx, "mcp:api:call");

  const endpoint = await ctx.catalogManager.getEndpoint(input.endpoint_id);
  if (!endpoint) {
    throw new McpToolError({
      code: "ENDPOINT_NOT_FOUND",
      message: defaultMessage("ENDPOINT_NOT_FOUND"),
    });
  }

  const started = Date.now();
  const normalized = normalizeParams(endpoint, input.params ?? {});
  const credential = await resolveUpstreamCredential(ctx, "mcp:api:call");
  const payload = await callUpstream(endpoint, normalized.apiParams, credential, ctx);
  const upstreamCode = Number(payload.code);
  const isSuccess = upstreamCode === 0;

  const nextStep = inferNextStep(endpoint, normalized.normalizedParams, payload);
  const hash = await runtimeTokenHash(ctx);

  ctx.logger.info("tool_call", {
    transport: ctx.transport,
    tool: "call_endpoint",
    endpoint_id: endpoint.endpoint_id,
    token_hash: hash,
    success: isSuccess,
    code: payload.code,
    duration_ms: Date.now() - started,
    truncated: false,
    param_keys: Object.keys(normalized.normalizedParams),
  });

  if (!isSuccess) {
    const code = mapUpstreamCode(Number.isFinite(upstreamCode) ? upstreamCode : undefined);
    return {
      ...errorResult({
        code,
        message: payload.message || defaultMessage(code),
        upstream_code: Number.isFinite(upstreamCode) ? upstreamCode : undefined,
      }),
      endpoint_id: endpoint.endpoint_id,
      code: payload.code,
      message: payload.message ?? null,
      warnings: normalized.warnings,
    };
  }

  return {
    success: true,
    endpoint_id: endpoint.endpoint_id,
    code: payload.code,
    message: payload.message ?? null,
    data: payload.data,
    raw: payload,
    truncated: false,
    next_step: nextStep,
    warnings: normalized.warnings,
  };
}

function normalizeParams(endpoint: EndpointCatalogEntry, input: Record<string, unknown>) {
  const byName = new Map(endpoint.params.map((param) => [param.name, param]));
  const byApiName = new Map(endpoint.params.map((param) => [param.api_name, param]));
  const apiParams = new Map<EndpointParam, unknown>();
  const normalizedParams: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    const param = byName.get(key) ?? byApiName.get(key);
    if (!param) {
      const suggestion = suggestParam(key, endpoint.params);
      warnings.push(
        suggestion
          ? `Ignored unknown parameter: ${key}. Did you mean ${suggestion}?`
          : `Ignored unknown parameter: ${key}.`
      );
      continue;
    }
    const converted = convertValue(param, value);
    apiParams.set(param, converted);
    normalizedParams[param.name] = converted;
  }

  const missing = endpoint.params
    .filter((param) => param.required && !apiParams.has(param))
    .map((param) => param.name);
  if (missing.length) {
    throw validationError(`Missing required parameter(s): ${missing.join(", ")}`, { missing });
  }

  return { apiParams, normalizedParams, warnings };
}

function convertValue(param: EndpointParam, value: unknown): unknown {
  if (value === undefined || value === null || value === "") {
    if (param.required) throw validationError(`Parameter ${param.name} is required.`);
    return value;
  }

  let converted = value;
  if (param.type === "integer") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(number))
      throw validationError(`Parameter ${param.name} must be an integer.`);
    converted = number;
  } else if (param.type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number))
      throw validationError(`Parameter ${param.name} must be a number.`);
    converted = number;
  } else if (param.type === "boolean") {
    if (typeof value === "boolean") converted = value;
    else if (value === "true") converted = true;
    else if (value === "false") converted = false;
    else throw validationError(`Parameter ${param.name} must be a boolean.`);
  } else if (param.type === "string" && typeof value !== "string") {
    converted = String(value);
  }

  if (param.enum?.length && !param.enum.some((item) => String(item) === String(converted))) {
    throw validationError(`Parameter ${param.name} must be one of: ${param.enum.join(", ")}.`, {
      allowed: param.enum,
    });
  }

  return converted;
}

async function callUpstream(
  endpoint: EndpointCatalogEntry,
  apiParams: Map<EndpointParam, unknown>,
  credential: UpstreamCredential,
  ctx: RuntimeContext
): Promise<UpstreamPayload> {
  const url = new URL(endpoint.path, ctx.config.baseUrl);
  const body = new URLSearchParams();
  const useFormBody =
    endpoint.method !== "GET" && endpoint.content_type === "application/x-www-form-urlencoded";

  if (credential.kind === "api-key") {
    if (useFormBody) body.set("token", credential.token);
    else url.searchParams.set("token", credential.token);
  }

  for (const [param, value] of apiParams.entries()) {
    if (value === undefined || value === null) continue;
    const encoded = encodeParamValue(value);
    if (param.in === "body" || useFormBody) {
      body.set(param.api_name, encoded);
    } else {
      url.searchParams.set(param.api_name, encoded);
    }
  }

  const response = await fetchOnce(
    url,
    {
      method: endpoint.method,
      headers: {
        ...(useFormBody ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(credential.kind === "oauth-delegation"
          ? { authorization: `Bearer ${credential.bearerToken}` }
          : {}),
      },
      body: useFormBody ? body : undefined,
    },
    ctx.config.timeoutMs
  );

  const text = await response.text();
  let payload: UpstreamPayload;
  try {
    payload = JSON.parse(text) as UpstreamPayload;
  } catch {
    throw new McpToolError({
      code: "UPSTREAM_ERROR",
      message: "Upstream returned a non-JSON response.",
      http_status: response.status,
    });
  }

  if (!response.ok) {
    return {
      code: payload.code ?? response.status,
      message: payload.message ?? `HTTP ${response.status}`,
      data: payload.data,
    };
  }
  return payload;
}

async function fetchOnce(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new McpToolError({
      code: aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
      message: aborted ? "Network timeout." : "Network error.",
    });
  } finally {
    clearTimeout(timer);
  }
}

function encodeParamValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function suggestParam(key: string, params: EndpointParam[]): string | undefined {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return params.find((param) => param.name.replace(/_/g, "").toLowerCase() === normalized)?.name;
}
