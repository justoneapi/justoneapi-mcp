import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/worker.js";
import { clearWorkerOAuthServicesForTests } from "../src/worker/oauth/services.js";
import {
  OAUTH_ACCESS_TOKEN,
  activeIntrospectionPayload,
  createPrivateJwks,
} from "./oauthFixtures.js";

let privateJwks = "";

beforeAll(async () => {
  privateJwks = (await createPrivateJwks()).raw;
});

afterEach(() => {
  clearWorkerOAuthServicesForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function env(mode: "off" | "dual" = "dual"): Env {
  return {
    JUSTONEAPI_OAUTH_MODE: mode,
    JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID: "test-key-1",
    JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS: privateJwks,
    JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_TTL_MS: "60000",
    JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_MAX_ENTRIES: "2048",
    JUSTONEAPI_OAUTH_AS_TIMEOUT_MS: "5000",
    JUSTONEAPI_MCP_ALLOWED_ORIGINS: "*",
    JUSTONEAPI_MCP_CATALOG: {} as KVNamespace,
  } as Env;
}

async function fetchWorker(request: Request, workerEnv = env()): Promise<Response> {
  return await worker.fetch(request, workerEnv, {} as ExecutionContext);
}

function toolCallRequest(
  protocolVersion: "2025-06-18" | "2026-07-28",
  tool = "call_endpoint",
  origin?: string
): Request {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  });
  if (protocolVersion === "2026-07-28") {
    headers.set("mcp-method", "tools/call");
    headers.set("mcp-name", tool);
  }
  if (origin) headers.set("origin", origin);
  return new Request("https://mcp.justoneapi.com/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: tool,
        arguments: { endpoint_id: "x", params: {} },
        ...(protocolVersion === "2026-07-28"
          ? {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            }
          : {}),
      },
    }),
  });
}

describe("Worker OAuth HTTP boundary", () => {
  it.each([
    ["dual", "2025-06-18"],
    ["dual", "2026-07-28"],
    ["off", "2025-06-18"],
    ["off", "2026-07-28"],
  ] as const)(
    "serves the v2 remote tool list in canonical %s mode through the %s stateless lane",
    async (mode, protocolVersion) => {
      const upstreamFetch = vi.fn();
      vi.stubGlobal("fetch", upstreamFetch);
      const headers = new Headers({
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${"A".repeat(16)}`,
        "content-type": "application/json",
        "mcp-protocol-version": protocolVersion,
      });
      if (protocolVersion === "2026-07-28") {
        headers.set("mcp-method", "tools/list");
      }
      const response = await fetchWorker(
        new Request("https://mcp.justoneapi.com/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params:
              protocolVersion === "2026-07-28"
                ? {
                    _meta: {
                      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                      "io.modelcontextprotocol/clientCapabilities": {},
                    },
                  }
                : {},
          }),
        }),
        env(mode)
      );
      const body = await response.text();
      expect(response.status, body).toBe(200);
      expect(body).toContain("search_endpoints");
      expect(body).toContain("call_endpoint");
      expect(body).not.toContain("refresh_catalog");
      if (mode === "dual") {
        expect(body).toContain("securitySchemes");
        expect(body).toContain("oauth2");
      } else {
        expect(body).not.toContain("securitySchemes");
        expect(body).not.toContain("oauth2");
      }
      expect(upstreamFetch).not.toHaveBeenCalled();
    }
  );

  it.each(["2025-06-18", "2026-07-28"] as const)(
    "returns HTTP 403 and a scope challenge before %s tools/call dispatch",
    async (protocolVersion) => {
      const asFetch = vi.fn(async () => Response.json(activeIntrospectionPayload()));
      vi.stubGlobal("fetch", asFetch);

      const response = await fetchWorker(
        toolCallRequest(protocolVersion, "call_endpoint", "https://chatgpt.com")
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
      expect(response.headers.get("www-authenticate")).toContain("mcp:api:call");
      expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
      expect(asFetch).toHaveBeenCalledOnce();
    }
  );

  it("publishes PRM only in canonical dual mode and keeps the canonical JWKS dark-deployable", async () => {
    const prmDual = await fetchWorker(
      new Request("https://mcp.justoneapi.com/.well-known/oauth-protected-resource/mcp")
    );
    expect(prmDual.status).toBe(200);
    await expect(prmDual.json()).resolves.toMatchObject({
      resource: "https://mcp.justoneapi.com/mcp",
      authorization_servers: ["https://auth.justoneapi.com"],
    });

    const prmOff = await fetchWorker(
      new Request("https://mcp.justoneapi.com/.well-known/oauth-protected-resource/mcp"),
      env("off")
    );
    expect(prmOff.status).toBe(404);

    const jwksOff = await fetchWorker(
      new Request("https://mcp.justoneapi.com/.well-known/jwks.json"),
      env("off")
    );
    expect(jwksOff.status).toBe(200);
    const jwks = (await jwksOff.json()) as { keys: Array<Record<string, unknown>> };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kid: "test-key-1",
      kty: "RSA",
      alg: "RS256",
      use: "sig",
    });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });

  it("fails the canonical JWKS readiness check when the active signing key is not usable", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invalidEnv = env("off");
    invalidEnv.JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID = "missing-key";
    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/.well-known/jwks.json"),
      invalidEnv
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "temporarily_unavailable" });
    const serializedLog = errorLog.mock.calls.flat().join("\n");
    expect(serializedLog).toContain('"event":"oauth_signing_configuration_invalid"');
    expect(serializedLog).toContain('"category":"active_kid_not_found"');
    expect(serializedLog).not.toContain(privateJwks);
  });

  it("logs only safe diagnostics when the Authorization Server rejects introspection", async () => {
    const upstreamDetail = "sensitive-upstream-detail";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const asFetch = vi.fn(async () =>
      Response.json({ error: "invalid_client", detail: upstreamDetail }, { status: 401 })
    );
    vi.stubGlobal("fetch", asFetch);
    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    );
    expect(response.status).toBe(503);
    expect(asFetch).toHaveBeenCalledOnce();
    const form = new URLSearchParams(String(asFetch.mock.calls[0][1]?.body));
    const assertion = form.get("client_assertion");
    if (!assertion) throw new Error("client assertion was not sent");
    const serializedLog = errorLog.mock.calls.flat().join("\n");
    expect(serializedLog).toContain('"event":"oauth_request_failed"');
    expect(serializedLog).toContain('"category":"authorization_server_unavailable"');
    expect(serializedLog).toContain('"upstream_kind":"http"');
    expect(serializedLog).toContain('"upstream_status":401');
    expect(serializedLog).not.toContain(OAUTH_ACCESS_TOKEN);
    expect(serializedLog).not.toContain(assertion);
    expect(serializedLog).not.toContain(upstreamDetail);
    expect(serializedLog).not.toContain(privateJwks);
  });

  it("logs a redirect status without following or exposing the redirect target", async () => {
    const redirectLocation = "https://attacker.invalid/sensitive-redirect";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const asFetch = vi.fn(
      async () => new Response(null, { status: 307, headers: { location: redirectLocation } })
    );
    vi.stubGlobal("fetch", asFetch);

    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    );

    expect(response.status).toBe(503);
    expect(asFetch).toHaveBeenCalledOnce();
    expect(asFetch.mock.calls[0][1]?.redirect).toBe("manual");
    const form = new URLSearchParams(String(asFetch.mock.calls[0][1]?.body));
    const assertion = form.get("client_assertion");
    if (!assertion) throw new Error("client assertion was not sent");
    const serializedLog = errorLog.mock.calls.flat().join("\n");
    expect(serializedLog).toContain('"upstream_kind":"redirect"');
    expect(serializedLog).toContain('"upstream_status":307');
    expect(serializedLog).not.toContain(redirectLocation);
    expect(serializedLog).not.toContain(OAUTH_ACCESS_TOKEN);
    expect(serializedLog).not.toContain(assertion);
  });

  it("logs only allowlisted network error types and cause codes", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const networkMessage = "sensitive network failure";
    const causeDetail = "sensitive cause detail";
    const asFetch = vi.fn(async () => {
      throw new TypeError(networkMessage, {
        cause: { code: "ECONNRESET", detail: causeDetail },
      });
    });
    vi.stubGlobal("fetch", asFetch);

    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    );

    expect(response.status).toBe(503);
    expect(asFetch).toHaveBeenCalledOnce();
    const form = new URLSearchParams(String(asFetch.mock.calls[0][1]?.body));
    const assertion = form.get("client_assertion");
    if (!assertion) throw new Error("client assertion was not sent");
    const serializedLog = errorLog.mock.calls.flat().join("\n");
    expect(serializedLog).toContain('"upstream_kind":"network"');
    expect(serializedLog).toContain('"upstream_error_name":"TypeError"');
    expect(serializedLog).toContain('"upstream_cause_code":"ECONNRESET"');
    expect(serializedLog).not.toContain(networkMessage);
    expect(serializedLog).not.toContain(causeDetail);
    expect(serializedLog).not.toContain(OAUTH_ACCESS_TOKEN);
    expect(serializedLog).not.toContain(assertion);
  });

  it("drops unknown network diagnostics from structured logs", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unknownName = "SensitiveCustomError";
    const unknownCode = "SECRET_INTERNAL_CODE";
    const networkMessage = "sensitive unknown network failure";
    const asFetch = vi.fn(async () => {
      const error = new Error(networkMessage, { cause: { code: unknownCode } });
      error.name = unknownName;
      throw error;
    });
    vi.stubGlobal("fetch", asFetch);

    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      })
    );

    expect(response.status).toBe(503);
    expect(asFetch).toHaveBeenCalledOnce();
    const form = new URLSearchParams(String(asFetch.mock.calls[0][1]?.body));
    const assertion = form.get("client_assertion");
    if (!assertion) throw new Error("client assertion was not sent");
    const serializedLog = errorLog.mock.calls.flat().join("\n");
    expect(serializedLog).toContain('"upstream_kind":"network"');
    expect(serializedLog).not.toContain("upstream_error_name");
    expect(serializedLog).not.toContain("upstream_cause_code");
    expect(serializedLog).not.toContain(unknownName);
    expect(serializedLog).not.toContain(unknownCode);
    expect(serializedLog).not.toContain(networkMessage);
    expect(serializedLog).not.toContain(OAUTH_ACCESS_TOKEN);
    expect(serializedLog).not.toContain(assertion);
  });

  it("never advertises or accepts OAuth on workers.dev preview routes", async () => {
    const asFetch = vi.fn();
    vi.stubGlobal("fetch", asFetch);
    const prm = await fetchWorker(
      new Request(
        "https://preview.justoneapi-mcp.workers.dev/.well-known/oauth-protected-resource/mcp"
      )
    );
    const jwks = await fetchWorker(
      new Request("https://preview.justoneapi-mcp.workers.dev/.well-known/jwks.json")
    );
    const tokenResponse = await fetchWorker(
      new Request("https://preview.justoneapi-mcp.workers.dev/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${OAUTH_ACCESS_TOKEN}` },
        body: "{}",
      })
    );
    expect(prm.status).toBe(404);
    expect(jwks.status).toBe(404);
    expect(tokenResponse.status).toBe(401);
    expect(tokenResponse.headers.has("www-authenticate")).toBe(false);
    expect(asFetch).not.toHaveBeenCalled();
  });

  it("keeps canonical mode off on the strict legacy lane without introspection", async () => {
    const asFetch = vi.fn();
    vi.stubGlobal("fetch", asFetch);
    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${OAUTH_ACCESS_TOKEN}` },
        body: "{}",
      }),
      env("off")
    );
    expect(response.status).toBe(401);
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect(asFetch).not.toHaveBeenCalled();
  });

  it.each(["http://mcp.justoneapi.com", "https://mcp.justoneapi.com:8443"])(
    "requires the exact canonical HTTPS origin for OAuth on %s",
    async (origin) => {
      const asFetch = vi.fn();
      vi.stubGlobal("fetch", asFetch);
      const prm = await fetchWorker(
        new Request(`${origin}/.well-known/oauth-protected-resource/mcp`)
      );
      const token = await fetchWorker(
        new Request(`${origin}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${OAUTH_ACCESS_TOKEN}` },
          body: "{}",
        })
      );
      expect(prm.status).toBe(404);
      expect(token.status).toBe(401);
      expect(asFetch).not.toHaveBeenCalled();
    }
  );

  it.each(["off", "dual"] as const)(
    "rejects same-request duplicate credentials in canonical %s mode",
    async (mode) => {
      const response = await fetchWorker(
        new Request("https://mcp.justoneapi.com/mcp", {
          method: "POST",
          headers: {
            authorization: `Bearer ${"A".repeat(16)}`,
            "x-justoneapi-token": "A".repeat(16),
          },
          body: "{}",
        }),
        env(mode)
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_request",
        error_description: "ambiguous_credentials",
      });
    }
  );

  it("authenticates before reading an OAuth request body", async () => {
    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(1024 * 1024 + 1),
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects an oversized body only after OAuth authentication", async () => {
    const asFetch = vi.fn(async () => Response.json(activeIntrospectionPayload("mcp:api:call")));
    vi.stubGlobal("fetch", asFetch);
    const response = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: "x".repeat(1024 * 1024 + 1),
      })
    );
    expect(response.status).toBe(413);
    expect(asFetch).toHaveBeenCalledOnce();
  });

  it("applies the configured CORS allowlist to preflight and rejects other origins", async () => {
    const corsEnv = env();
    corsEnv.JUSTONEAPI_MCP_ALLOWED_ORIGINS = "https://chatgpt.com";
    const allowed = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://chatgpt.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      }),
      corsEnv
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(allowed.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");

    const denied = await fetchWorker(
      new Request("https://mcp.justoneapi.com/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://attacker.invalid" },
      }),
      corsEnv
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });
});
