import { config, requireToken, toSafeUrlForLog } from "./config.js";
import { isUpstreamOk } from "./errors.js";

/**
 * GET JSON helper for JustOneAPI style responses:
 * - HTTP may be 200 even when business code != 0
 * - Throws when:
 *   - HTTP status not OK
 *   - JSON parse fails
 *   - business code != 0
 * Includes:
 * - timeout
 * - small retry
 * - safe logging (never leaks token)
 */
export async function getJson(pathWithQuery: string) {
  // ensure token exists early (so we can return INVALID_TOKEN)
  requireToken();

  const url = `${config.baseUrl}${pathWithQuery}`;

  const attempts = 1 + Math.max(0, Number.isFinite(config.retry) ? config.retry : 0);
  let lastErr: any;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      if (config.debug) {
        console.error(`[justoneapi] GET ${toSafeUrlForLog(url)} (attempt ${attempt}/${attempts})`);
      }

      const res = await fetch(url, { method: "GET", signal: controller.signal });
      const text = await res.text();

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        const err: any = new Error("Failed to parse JSON response from upstream.");
        err.httpStatus = res.status;
        err.payload = text;
        throw err;
      }

      // HTTP-level error
      if (!res.ok) {
        const err: any = new Error(json?.message ?? `HTTP ${res.status}`);
        err.httpStatus = res.status;
        err.payload = json;
        // If upstream also provides code, keep it
        if (json?.code !== undefined) err.upstreamCode = Number(json.code);
        throw err;
      }

      // Business-level error (code != 0)
      if (!isUpstreamOk(json)) {
        const err: any = new Error(json?.message ?? `Upstream code ${json?.code}`);
        err.upstreamCode = Number(json?.code);
        err.payload = json;
        throw err;
      }

      return json;
    } catch (e: any) {
      lastErr = e;

      // Retry only for:
      // - timeout (AbortError)
      // - HTTP 5xx
      // - network-type failures
      const httpStatus = e?.httpStatus;
      const retryable =
        e?.name === "AbortError" ||
        (typeof httpStatus === "number" && httpStatus >= 500) ||
        e?.code === "ECONNRESET" ||
        e?.code === "ECONNREFUSED" ||
        e?.code === "ENOTFOUND";

      if (!retryable || attempt === attempts) break;

      // small backoff
      await new Promise((r) => setTimeout(r, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}