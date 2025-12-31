export type JOAErrorCode =
  | "INVALID_TOKEN"
  | "COLLECT_FAILED"
  | "RATE_LIMITED"
  | "DAILY_QUOTA_EXCEEDED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "PERMISSION_DENIED"
  | "INSUFFICIENT_BALANCE"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR";

export type UpstreamResponse = {
  code?: number;
  message?: string | null;
  recordTime?: string;
  data?: any;
};

export function isUpstreamOk(resp: UpstreamResponse): boolean {
  return Number(resp?.code) === 0;
}

export function mapUpstreamCode(code: number | undefined): JOAErrorCode {
  switch (code) {
    case 100:
      return "INVALID_TOKEN";
    case 301:
      return "COLLECT_FAILED";
    case 302:
      return "RATE_LIMITED";
    case 303:
      return "DAILY_QUOTA_EXCEEDED";
    case 400:
      return "VALIDATION_ERROR";
    case 500:
      return "INTERNAL_ERROR";
    case 600:
      return "PERMISSION_DENIED";
    case 601:
      return "INSUFFICIENT_BALANCE";
    default:
      return "UPSTREAM_ERROR";
  }
}

export function buildUserMessage(
  mcpCode: JOAErrorCode,
  upstreamMessage?: string | null
): string {
  const base =
    upstreamMessage && upstreamMessage.trim()
      ? upstreamMessage.trim()
      : undefined;

  switch (mcpCode) {
    case "INVALID_TOKEN":
      return base ?? "Invalid or inactive token. Please update JUSTONEAPI_TOKEN.";
    case "COLLECT_FAILED":
      return base ?? "Collection failed. Please retry after a short delay.";
    case "RATE_LIMITED":
      return base ?? "Rate limit exceeded. Please slow down and retry later.";
    case "DAILY_QUOTA_EXCEEDED":
      return base ?? "Daily quota exceeded. Please try again tomorrow or upgrade your plan.";
    case "VALIDATION_ERROR":
      return base ?? "Invalid parameters. Please check the input values.";
    case "PERMISSION_DENIED":
      return base ?? "Permission denied. Please verify your account permissions.";
    case "INSUFFICIENT_BALANCE":
      return base ?? "Insufficient balance. Please top up your account.";
    case "INTERNAL_ERROR":
      return base ?? "Internal server error. Please retry later.";
    case "NETWORK_TIMEOUT":
      return base ?? "Network timeout. Please retry later.";
    case "NETWORK_ERROR":
      return base ?? "Network error. Please retry later.";
    default:
      return base ?? "Upstream error. Please retry later.";
  }
}

export function toMcpErrorPayload(e: any): {
  code: JOAErrorCode;
  message: string;
  upstreamCode?: number;
  httpStatus?: number;
} {
  // Timeout from AbortController
  if (e?.name === "AbortError") {
    return { code: "NETWORK_TIMEOUT", message: buildUserMessage("NETWORK_TIMEOUT") };
  }

  // Our own thrown upstreamCode (business code)
  if (e?.upstreamCode !== undefined) {
    const upstreamCode = Number(e.upstreamCode);
    const mcpCode = mapUpstreamCode(upstreamCode);
    return {
      code: mcpCode,
      message: buildUserMessage(mcpCode, e?.message),
      upstreamCode,
      httpStatus: typeof e?.httpStatus === "number" ? e.httpStatus : undefined,
    };
  }

  // HTTP level errors if any
  if (typeof e?.httpStatus === "number") {
    return {
      code: "UPSTREAM_ERROR",
      message: e?.message ?? `HTTP error ${e.httpStatus}`,
      httpStatus: e.httpStatus,
    };
  }

  // Generic network errors
  if (e?.cause || e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND") {
    return {
      code: "NETWORK_ERROR",
      message: e?.message ?? buildUserMessage("NETWORK_ERROR"),
    };
  }

  return { code: "UPSTREAM_ERROR", message: e?.message ?? "Unknown error" };
}