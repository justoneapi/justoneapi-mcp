import type { WorkerOAuthConfig } from "./oauth/config.js";

export const MCP_CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "X-JustOneAPI-Token",
  "Mcp-Session-Id",
  "MCP-Protocol-Version",
  "Mcp-Method",
  "Mcp-Name",
  "Last-Event-ID",
].join(", ");

export const MCP_CORS_EXPOSE_HEADERS = ["Mcp-Session-Id", "WWW-Authenticate"].join(", ");

export function isAllowedWorkerHost(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return (
    hostname === "mcp.justoneapi.com" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".workers.dev")
  );
}

export function isCanonicalOAuthHost(request: Request): boolean {
  return new URL(request.url).origin.toLowerCase() === "https://mcp.justoneapi.com";
}

export function corsOrigin(request: Request, config: WorkerOAuthConfig): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (config.allowedOrigins === "*") return "*";
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return null;
  }
  return config.allowedOrigins.has(normalized) ? normalized : null;
}

export function preflightResponse(request: Request, config: WorkerOAuthConfig): Response {
  const requestedOrigin = request.headers.get("origin");
  const allowedOrigin = corsOrigin(request, config);
  if (requestedOrigin && !allowedOrigin) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  return withCors(new Response(null, { status: 204 }), request, config);
}

export function withCors(
  response: Response,
  request: Request,
  config: WorkerOAuthConfig
): Response {
  const origin = corsOrigin(request, config);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", MCP_CORS_ALLOW_HEADERS);
  headers.set("Access-Control-Expose-Headers", MCP_CORS_EXPOSE_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: allowed.join(", ") } }
  );
}
