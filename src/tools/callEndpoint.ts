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
import { RuntimeContext } from "../common/runtime.js";
import { tokenHash } from "../common/auth.js";
import { truncateJson } from "../common/truncate.js";

export const CallEndpointInput = z.object({
  endpoint_id: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}).optional(),
  max_items: z.number().int().min(1).max(100).default(20).optional(),
});

type UpstreamPayload = {
  code?: number;
  message?: string | null;
  data?: unknown;
  [key: string]: unknown;
};

export async function callEndpoint(input: z.infer<typeof CallEndpointInput>, ctx: RuntimeContext) {
  const token = ctx.getToken();
  if (!token) {
    throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
  }

  const endpoint = await ctx.catalogManager.getEndpoint(input.endpoint_id);
  if (!endpoint) {
    throw new McpToolError({
      code: "ENDPOINT_NOT_FOUND",
      message: `Unknown endpoint_id: ${input.endpoint_id}`,
    });
  }

  const started = Date.now();
  const normalized = normalizeParams(endpoint, input.params ?? {});
  const payload = await callUpstream(endpoint, normalized.apiParams, token, ctx);
  const upstreamCode = Number(payload.code);
  const isSuccess = upstreamCode === 0;

  const truncated = truncateJson(payload, {
    maxItems: input.max_items ?? 20,
    maxTextLength: 4000,
    maxDepth: 8,
  });
  const raw = truncated.value as UpstreamPayload;
  const nextStep = inferNextStep(endpoint, normalized.normalizedParams, payload);
  const hash = await tokenHash(token);

  ctx.logger.info("tool_call", {
    transport: ctx.transport,
    tool: "call_endpoint",
    endpoint_id: endpoint.endpoint_id,
    token_hash: hash,
    success: isSuccess,
    code: payload.code,
    duration_ms: Date.now() - started,
    truncated: truncated.truncated,
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
    data: raw.data,
    raw,
    truncated: truncated.truncated,
    truncation: truncated.truncated
      ? {
          max_items: input.max_items ?? 20,
          paths: truncated.paths,
        }
      : undefined,
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
  token: string,
  ctx: RuntimeContext
): Promise<UpstreamPayload> {
  const url = new URL(endpoint.path, ctx.config.baseUrl);
  const body = new URLSearchParams();
  const useFormBody =
    endpoint.method !== "GET" && endpoint.content_type === "application/x-www-form-urlencoded";

  if (useFormBody) body.set("token", token);
  else url.searchParams.set("token", token);

  for (const [param, value] of apiParams.entries()) {
    if (value === undefined || value === null) continue;
    const encoded = encodeParamValue(value);
    if (param.in === "body" || useFormBody) {
      body.set(param.api_name, encoded);
    } else {
      url.searchParams.set(param.api_name, encoded);
    }
  }

  const response = await fetchWithRetry(
    url,
    {
      method: endpoint.method,
      headers: useFormBody ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: useFormBody ? body : undefined,
    },
    ctx.config.retry,
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

async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  retry: number,
  timeoutMs: number
): Promise<Response> {
  const attempts = 1 + Math.max(0, retry);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (![502, 503, 504].includes(response.status) || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }

  const aborted = lastError instanceof Error && lastError.name === "AbortError";
  throw new McpToolError({
    code: aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
    message: aborted ? "Network timeout." : "Network error.",
  });
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
