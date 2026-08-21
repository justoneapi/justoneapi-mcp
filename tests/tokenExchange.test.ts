import { describe, expect, it, vi } from "vitest";
import { McpOAuthToolError, McpToolError } from "../src/common/errors.js";
import type { AuthorizationServerClient } from "../src/worker/oauth/authorizationServerClient.js";
import { AuthorizationServerRequestError } from "../src/worker/oauth/authorizationServerClient.js";
import { loadWorkerOAuthConfig } from "../src/worker/oauth/config.js";
import type { IntrospectionTokenVerifier } from "../src/worker/oauth/introspection.js";
import { RequestTokenExchange } from "../src/worker/oauth/tokenExchange.js";
import { OAUTH_ACCESS_TOKEN, OAUTH_DELEGATION_TOKEN } from "./oauthFixtures.js";

function exchangeWith(postForm: ReturnType<typeof vi.fn>, invalidate = vi.fn()) {
  return {
    exchange: new RequestTokenExchange(
      loadWorkerOAuthConfig({ JUSTONEAPI_OAUTH_MODE: "dual" }),
      { postForm } as unknown as AuthorizationServerClient,
      { invalidate } as unknown as IntrospectionTokenVerifier,
      OAUTH_ACCESS_TOKEN
    ),
    invalidate,
  };
}

function validResponse(scope: "mcp:api:call" | "mcp:account:read") {
  return {
    access_token: OAUTH_DELEGATION_TOKEN,
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 120,
    scope,
  };
}

describe("RFC 8693 request-local delegation exchange", () => {
  it("sends the exact exchange form and memoizes only within the request and scope", async () => {
    const postForm = vi.fn(async (_endpoint: string, form: URLSearchParams) =>
      validResponse(form.get("scope") as "mcp:api:call" | "mcp:account:read")
    );
    const { exchange } = exchangeWith(postForm);
    const first = exchange.exchange("mcp:api:call");
    const second = exchange.exchange("mcp:api:call");
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ token: OAUTH_DELEGATION_TOKEN }),
      expect.objectContaining({ token: OAUTH_DELEGATION_TOKEN }),
    ]);
    expect(postForm).toHaveBeenCalledOnce();
    const [endpoint, form] = postForm.mock.calls[0] as [string, URLSearchParams];
    expect(endpoint).toBe("https://auth.justoneapi.com/oauth2/token");
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: OAUTH_ACCESS_TOKEN,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: "https://api.justoneapi.com",
      scope: "mcp:api:call",
    });

    await exchange.exchange("mcp:account:read");
    expect(postForm).toHaveBeenCalledTimes(2);
    const nextRequest = exchangeWith(postForm).exchange;
    await nextRequest.exchange("mcp:api:call");
    expect(postForm).toHaveBeenCalledTimes(3);
  });

  it("never exchanges catalog-only scope", async () => {
    const postForm = vi.fn();
    const { exchange } = exchangeWith(postForm);
    await expect(exchange.exchange("mcp:catalog:read")).rejects.toThrow(
      "Catalog tools do not use delegation"
    );
    expect(postForm).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong response scope", { scope: "mcp:account:read" }],
    ["refresh token", { refresh_token: "must-not-be-issued" }],
    ["overlong lifetime", { expires_in: 121 }],
    ["wrong token type", { token_type: "DPoP" }],
    ["malformed delegation token", { access_token: "not-a-delegation-token" }],
  ])("rejects a contract-invalid %s", async (_name, override) => {
    const postForm = vi.fn(async () => ({ ...validResponse("mcp:api:call"), ...override }));
    const { exchange } = exchangeWith(postForm);
    await expect(exchange.exchange("mcp:api:call")).rejects.toMatchObject({
      payload: { code: "UPSTREAM_ERROR" },
    });
    expect(postForm).toHaveBeenCalledOnce();
  });

  it.each(["invalid_grant", "invalid_token"])(
    "evicts introspection and returns a relink challenge for %s",
    async (oauthError) => {
      const postForm = vi.fn(async () => {
        throw new AuthorizationServerRequestError("http", "rejected", { oauthError });
      });
      const { exchange, invalidate } = exchangeWith(postForm);
      const failure = await exchange.exchange("mcp:api:call").catch((error) => error);
      expect(failure).toBeInstanceOf(McpOAuthToolError);
      expect(failure.challenges[0]).toContain('error="invalid_token"');
      expect(invalidate).toHaveBeenCalledWith(OAUTH_ACCESS_TOKEN);
      expect(postForm).toHaveBeenCalledOnce();
    }
  );

  it("maps invalid_scope to a scope challenge and invalid_target to a fail-closed contract error", async () => {
    const invalidScope = vi.fn(async () => {
      throw new AuthorizationServerRequestError("http", "rejected", {
        oauthError: "invalid_scope",
      });
    });
    const scopeFailure = await exchangeWith(invalidScope)
      .exchange.exchange("mcp:api:call")
      .catch((error) => error);
    expect(scopeFailure).toBeInstanceOf(McpOAuthToolError);
    expect(scopeFailure.challenges[0]).toContain('error="insufficient_scope"');
    expect(invalidScope).toHaveBeenCalledOnce();

    const invalidTarget = vi.fn(async () => {
      throw new AuthorizationServerRequestError("http", "rejected", {
        oauthError: "invalid_target",
      });
    });
    const targetFailure = await exchangeWith(invalidTarget)
      .exchange.exchange("mcp:api:call")
      .catch((error) => error);
    expect(targetFailure).toBeInstanceOf(McpToolError);
    expect(targetFailure.payload.code).toBe("UPSTREAM_ERROR");
    expect(invalidTarget).toHaveBeenCalledOnce();
  });

  it("does not retry network or timeout failures", async () => {
    for (const kind of ["network", "timeout"] as const) {
      const postForm = vi.fn(async () => {
        throw new AuthorizationServerRequestError(kind, "unavailable");
      });
      const { exchange } = exchangeWith(postForm);
      await expect(exchange.exchange("mcp:api:call")).rejects.toMatchObject({
        payload: { code: kind === "timeout" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR" },
      });
      expect(postForm).toHaveBeenCalledOnce();
    }
  });
});
