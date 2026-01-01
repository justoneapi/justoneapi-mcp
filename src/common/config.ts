import "dotenv/config";

export const config = {
  baseUrl: process.env.JUSTONEAPI_BASE_URL ?? "https://api.justoneapi.com",
  token: process.env.JUSTONEAPI_TOKEN ?? "",

  // Debug logs go to stderr so Claude Desktop can display them.
  debug: (process.env.JUSTONEAPI_DEBUG ?? "").toLowerCase() === "true",

  // Network behavior
  timeoutMs: Number(process.env.JUSTONEAPI_TIMEOUT_MS ?? "20000"),
  retry: Number(process.env.JUSTONEAPI_RETRY ?? "1"), // number of retries after the first attempt

  // Output control
  maxItems: Number(process.env.JUSTONEAPI_MAX_ITEMS ?? "10"),
  includeRaw: (process.env.JUSTONEAPI_INCLUDE_RAW ?? "").toLowerCase() === "true",
};

export function requireToken(): string {
  if (!config.token || !config.token.trim()) {
    const err: any = new Error(
      "Missing JUSTONEAPI_TOKEN. Please set it in the MCP server environment."
    );
    err.upstreamCode = 100; // align with your upstream: Invalid token
    throw err;
  }
  return config.token.trim();
}

export function maskToken(t: string): string {
  const s = (t ?? "").trim();
  if (!s) return "";
  if (s.length <= 8) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

/**
 * Build a "safe" URL for logging:
 * - keeps path
 * - masks token query parameter
 */
export function toSafeUrlForLog(fullUrl: string): string {
  try {
    const u = new URL(fullUrl);
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", maskToken(u.searchParams.get("token") ?? ""));
    }
    return u.toString();
  } catch {
    // Fallback: best-effort masking
    return fullUrl.replace(/token=([^&]+)/g, (_m, g1) => `token=${maskToken(g1)}`);
  }
}
