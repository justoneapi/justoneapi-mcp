import { z } from "zod";
import { tokenHash } from "../common/auth.js";
import { McpToolError, defaultMessage, errorResult, mapUpstreamCode } from "../common/errors.js";
import { RuntimeContext } from "../common/runtime.js";
import { truncateJson } from "../common/truncate.js";

export const GetAccountBalanceInput = z.object({});

export const GetUsageSummaryInput = z.object({
  max_items: z.number().int().min(1).max(100).default(100).optional(),
});

type UpstreamPayload = {
  code?: number;
  message?: string | null;
  data?: unknown;
  [key: string]: unknown;
};

export async function getAccountBalance(
  _input: z.infer<typeof GetAccountBalanceInput>,
  ctx: RuntimeContext
) {
  const token = requireToken(ctx);
  const started = Date.now();
  const payload = await callAccountEndpoint("/user/get-balance", token, ctx);
  const result = buildResult(payload, "get_account_balance");
  await logAccountTool(ctx, "get_account_balance", token, payload, started);
  return result;
}

export async function getUsageSummary(
  input: z.infer<typeof GetUsageSummaryInput>,
  ctx: RuntimeContext
) {
  const token = requireToken(ctx);
  const started = Date.now();
  const payload = await callAccountEndpoint("/user/get-usage-summary", token, ctx);
  const truncated = truncateJson(payload, {
    maxItems: input.max_items ?? 100,
    maxTextLength: 4000,
    maxDepth: 8,
  });
  const result = buildResult(truncated.value as UpstreamPayload, "get_usage_summary");
  await logAccountTool(ctx, "get_usage_summary", token, payload, started, truncated.truncated);
  return {
    ...result,
    truncated: truncated.truncated,
    truncation: truncated.truncated
      ? {
          max_items: input.max_items ?? 100,
          paths: truncated.paths,
        }
      : undefined,
  };
}

function requireToken(ctx: RuntimeContext): string {
  const token = ctx.getToken();
  if (!token) {
    throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
  }
  return token;
}

async function callAccountEndpoint(
  path: "/user/get-balance" | "/user/get-usage-summary",
  token: string,
  ctx: RuntimeContext
): Promise<UpstreamPayload> {
  const url = new URL(path, ctx.config.baseUrl);
  url.searchParams.set("token", token);

  const response = await fetchWithRetry(
    url,
    { method: "GET" },
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

function buildResult(payload: UpstreamPayload, tool: string) {
  const upstreamCode = Number(payload.code);
  const isSuccess = upstreamCode === 0;
  if (!isSuccess) {
    const code = mapUpstreamCode(Number.isFinite(upstreamCode) ? upstreamCode : undefined);
    return {
      ...errorResult({
        code,
        message: payload.message || defaultMessage(code),
        upstream_code: Number.isFinite(upstreamCode) ? upstreamCode : undefined,
      }),
      tool,
      code: payload.code,
      message: payload.message ?? null,
    };
  }

  return {
    success: true,
    tool,
    code: payload.code,
    message: payload.message ?? null,
    data: payload.data,
    raw: payload,
  };
}

async function logAccountTool(
  ctx: RuntimeContext,
  tool: "get_account_balance" | "get_usage_summary",
  token: string,
  payload: UpstreamPayload,
  started: number,
  truncated = false
) {
  ctx.logger.info("tool_call", {
    transport: ctx.transport,
    tool,
    token_hash: await tokenHash(token),
    success: Number(payload.code) === 0,
    code: payload.code,
    duration_ms: Date.now() - started,
    truncated,
  });
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
