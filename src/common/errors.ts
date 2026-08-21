export type McpErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "COLLECT_FAILED"
  | "RATE_LIMITED"
  | "DAILY_QUOTA_EXCEEDED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "PERMISSION_DENIED"
  | "INSUFFICIENT_BALANCE"
  | "TOKEN_LIMIT_EXCEEDED"
  | "ENDPOINT_NOT_FOUND"
  | "CATALOG_NOT_READY"
  | "CATALOG_REFRESH_FAILED"
  | "OPENAPI_FETCH_FAILED"
  | "OPENAPI_PARSE_FAILED"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR";

export type McpErrorPayload = {
  code: McpErrorCode;
  message: string;
  upstream_code?: number;
  http_status?: number;
  details?: Record<string, unknown>;
};

export class McpToolError extends Error {
  readonly payload: McpErrorPayload;

  constructor(payload: McpErrorPayload) {
    super(payload.message);
    this.payload = payload;
  }
}

export class McpOAuthToolError extends McpToolError {
  readonly challenges: string[];

  constructor(payload: McpErrorPayload, challenges: string[]) {
    super(payload);
    this.challenges = challenges;
  }
}

export function mapUpstreamCode(code: number | undefined): McpErrorCode {
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
    case 602:
      return "TOKEN_LIMIT_EXCEEDED";
    default:
      return "UPSTREAM_ERROR";
  }
}

export function defaultMessage(code: McpErrorCode): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "缺少 JustOneAPI token，请配置 JUSTONEAPI_TOKEN 或 Authorization header。";
    case "INVALID_TOKEN":
      return "Token 无效或已失效。";
    case "COLLECT_FAILED":
      return "采集失败，请稍后重试。";
    case "RATE_LIMITED":
      return "超出速率限制，请稍后重试。";
    case "DAILY_QUOTA_EXCEEDED":
      return "超出每日配额。";
    case "VALIDATION_ERROR":
      return "请求参数错误。";
    case "PERMISSION_DENIED":
      return "权限不足。";
    case "INSUFFICIENT_BALANCE":
      return "账户共享余额不足。";
    case "TOKEN_LIMIT_EXCEEDED":
      return "当前 API TOKEN 的累计消费上限已达到。多个 TOKEN 仍共享同一个账户余额；如需继续使用，请调整该 TOKEN 的消费上限或更换 TOKEN。";
    case "ENDPOINT_NOT_FOUND":
      return "未找到指定 endpoint_id。";
    case "CATALOG_NOT_READY":
      return "接口目录尚未准备好。";
    case "CATALOG_REFRESH_FAILED":
      return "接口目录刷新失败。";
    case "OPENAPI_FETCH_FAILED":
      return "拉取 OpenAPI 失败。";
    case "OPENAPI_PARSE_FAILED":
      return "解析 OpenAPI 失败。";
    case "NETWORK_TIMEOUT":
      return "网络请求超时。";
    case "NETWORK_ERROR":
      return "网络请求失败。";
    case "INTERNAL_ERROR":
      return "内部服务器错误。";
    case "UPSTREAM_ERROR":
    default:
      return "上游服务错误。";
  }
}

export function errorResult(error: McpErrorPayload): { success: false; error: McpErrorPayload } {
  const { message, ...rest } = error;
  return {
    success: false,
    error: {
      ...rest,
      message: message || defaultMessage(error.code),
    },
  };
}

export function validationError(message: string, details?: Record<string, unknown>): McpToolError {
  return new McpToolError({ code: "VALIDATION_ERROR", message, details });
}
