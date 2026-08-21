import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationServerClient,
  AuthorizationServerRequestError,
} from "../src/worker/oauth/authorizationServerClient.js";
import { loadWorkerOAuthConfig } from "../src/worker/oauth/config.js";
import { parsePrivateJwkSet } from "../src/worker/oauth/jwks.js";
import { createPrivateJwks } from "./oauthFixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Authorization Server private_key_jwt client", () => {
  it("sends exact form authentication and a short-lived audience-bound assertion", async () => {
    const fixture = await createPrivateJwks(["active"]);
    const config = loadWorkerOAuthConfig({
      JUSTONEAPI_OAUTH_MODE: "dual",
      JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID: "active",
      JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS: fixture.raw,
    });
    const seenAssertions: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://auth.justoneapi.com/oauth2/introspect");
      expect(init?.redirect).toBe("error");
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("token")).toBe("subject-token");
      expect(form.get("client_id")).toBe("justoneapi-mcp-worker");
      expect(form.get("client_assertion_type")).toBe(
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
      );
      seenAssertions.push(form.get("client_assertion") ?? "");
      return Response.json({ active: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AuthorizationServerClient(config, parsePrivateJwkSet(fixture.raw));

    await client.postForm(
      config.introspectionEndpoint,
      new URLSearchParams({ token: "subject-token" })
    );
    await client.postForm(
      config.introspectionEndpoint,
      new URLSearchParams({ token: "subject-token" })
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenAssertions[0]).not.toBe(seenAssertions[1]);
    const header = decodeProtectedHeader(seenAssertions[0]);
    const claims = decodeJwt(seenAssertions[0]);
    expect(header).toEqual({ alg: "RS256", kid: "active", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: "justoneapi-mcp-worker",
      sub: "justoneapi-mcp-worker",
      aud: "https://auth.justoneapi.com/oauth2/introspect",
    });
    expect(claims.exp).toBe((claims.iat ?? 0) + 60);
    expect(claims.nbf).toBe((claims.iat ?? 0) - 5);
    expect(typeof claims.jti).toBe("string");
  });

  it("allows only fixed AS endpoints and never retries failures", async () => {
    const fixture = await createPrivateJwks(["active"]);
    const config = loadWorkerOAuthConfig({
      JUSTONEAPI_OAUTH_MODE: "dual",
      JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID: "active",
      JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS: fixture.raw,
    });
    const client = new AuthorizationServerClient(config, parsePrivateJwkSet(fixture.raw));
    await expect(
      client.postForm("https://attacker.invalid/token", new URLSearchParams())
    ).rejects.toThrow("not allowlisted");

    const fetchMock = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      client.postForm(config.tokenEndpoint, new URLSearchParams())
    ).rejects.toMatchObject({
      kind: "timeout",
    } satisfies Partial<AuthorizationServerRequestError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects oversized, non-JSON, and OAuth error responses without exposing their body", async () => {
    const fixture = await createPrivateJwks(["active"]);
    const config = loadWorkerOAuthConfig({
      JUSTONEAPI_OAUTH_MODE: "dual",
      JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID: "active",
      JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS: fixture.raw,
    });
    const client = new AuthorizationServerClient(config, parsePrivateJwkSet(fixture.raw));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-length": "65537" } }))
    );
    await expect(
      client.postForm(config.tokenEndpoint, new URLSearchParams())
    ).rejects.toMatchObject({
      kind: "invalid_response",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret-body"))
    );
    await expect(
      client.postForm(config.tokenEndpoint, new URLSearchParams())
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: expect.not.stringContaining("secret-body"),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "invalid_target", detail: "secret" }, { status: 400 })
      )
    );
    await expect(
      client.postForm(config.tokenEndpoint, new URLSearchParams())
    ).rejects.toMatchObject({
      kind: "http",
      status: 400,
      oauthError: "invalid_target",
      message: expect.not.stringContaining("secret"),
    });
  });
});
