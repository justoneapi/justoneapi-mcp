import { OAuthError } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationServerClient } from "../src/worker/oauth/authorizationServerClient.js";
import { AuthorizationServerRequestError } from "../src/worker/oauth/authorizationServerClient.js";
import { loadWorkerOAuthConfig } from "../src/worker/oauth/config.js";
import {
  IntrospectionTokenVerifier,
  OAuthInfrastructureError,
} from "../src/worker/oauth/introspection.js";
import { OAUTH_ACCESS_TOKEN, activeIntrospectionPayload } from "./oauthFixtures.js";

afterEach(() => {
  vi.useRealTimers();
});

function verifier(
  postForm: ReturnType<typeof vi.fn>,
  options: { ttl?: number; max?: number } = {}
): IntrospectionTokenVerifier {
  const config = loadWorkerOAuthConfig({
    JUSTONEAPI_OAUTH_MODE: "dual",
    JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_TTL_MS: String(options.ttl ?? 60_000),
    JUSTONEAPI_OAUTH_INTROSPECTION_CACHE_MAX_ENTRIES: String(options.max ?? 2_048),
  });
  return new IntrospectionTokenVerifier(config, {
    postForm,
  } as unknown as AuthorizationServerClient);
}

describe("opaque access-token introspection", () => {
  it("validates the exact issuer, audience, known scopes, and optional time claims", async () => {
    const postForm = vi.fn(async () => activeIntrospectionPayload("mcp:catalog:read mcp:api:call"));
    const auth = await verifier(postForm).verifyAccessToken(OAUTH_ACCESS_TOKEN);
    expect(auth).toMatchObject({
      token: OAUTH_ACCESS_TOKEN,
      clientId: "chatgpt-client",
      scopes: ["mcp:catalog:read", "mcp:api:call"],
      resource: new URL("https://mcp.justoneapi.com/mcp"),
      extra: { subject: "user-1", connectionId: "connection-1" },
    });
    const form = postForm.mock.calls[0][1] as URLSearchParams;
    expect(form.get("token")).toBe(OAUTH_ACCESS_TOKEN);
    expect(form.get("token_type_hint")).toBe("access_token");
  });

  it.each([
    [
      "extra audience",
      { aud: ["https://mcp.justoneapi.com/mcp", "https://other.invalid"] },
      OAuthError,
    ],
    ["wrong audience", { aud: "https://other.invalid" }, OAuthError],
    ["unknown scope", { scope: "mcp:catalog:read admin:all" }, OAuthInfrastructureError],
    ["empty scope", { scope: "" }, OAuthInfrastructureError],
    ["future issued-at", { iat: Math.floor(Date.now() / 1000) + 120 }, OAuthError],
    ["future not-before", { nbf: Math.floor(Date.now() / 1000) + 120 }, OAuthError],
    ["malformed issued-at", { iat: "now" }, OAuthInfrastructureError],
    ["missing issued-at", { iat: undefined }, OAuthInfrastructureError],
  ])("rejects %s", async (_name, override, ErrorType) => {
    const postForm = vi.fn(async () => ({ ...activeIntrospectionPayload(), ...override }));
    await expect(verifier(postForm).verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toBeInstanceOf(
      ErrorType
    );
  });

  it("caches only positive results, deduplicates in-flight introspection, and enforces LRU size", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>((done) => {
      resolve = done;
    });
    const postForm = vi.fn(async () => await pending);
    const tokenVerifier = verifier(postForm, { max: 1 });
    const first = tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    const second = tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    await vi.waitFor(() => expect(postForm).toHaveBeenCalledOnce());
    resolve(activeIntrospectionPayload());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    expect(postForm).toHaveBeenCalledOnce();

    postForm.mockResolvedValue(activeIntrospectionPayload());
    const otherToken = OAUTH_ACCESS_TOKEN.replace(/a/, "z");
    await tokenVerifier.verifyAccessToken(otherToken);
    await tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    expect(postForm).toHaveBeenCalledTimes(3);
  });

  it("does not cache inactive tokens or Authorization Server failures", async () => {
    const inactive = vi.fn(async () => ({ active: false }));
    const inactiveVerifier = verifier(inactive);
    await expect(inactiveVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toBeInstanceOf(
      OAuthError
    );
    await expect(inactiveVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toBeInstanceOf(
      OAuthError
    );
    expect(inactive).toHaveBeenCalledTimes(2);

    const failed = vi.fn(async () => {
      throw new AuthorizationServerRequestError("network", "unavailable");
    });
    const failedVerifier = verifier(failed);
    await expect(failedVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toMatchObject({
      code: "authorization_server_unavailable",
      upstreamKind: "network",
      upstreamStatus: undefined,
    });
    await expect(failedVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toMatchObject({
      code: "authorization_server_unavailable",
    });
    expect(failed).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(async () => {
      throw new AuthorizationServerRequestError("http", "rejected", { status: 401 });
    });
    await expect(verifier(rejected).verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toMatchObject({
      code: "authorization_server_unavailable",
      upstreamKind: "http",
      upstreamStatus: 401,
    });
  });

  it("caps cache lifetime at token expiry and supports explicit revocation eviction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:00:00Z"));
    const exp = Math.floor(Date.now() / 1000) + 2;
    const postForm = vi.fn(async () => ({ ...activeIntrospectionPayload(), exp }));
    const tokenVerifier = verifier(postForm);
    await tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    await tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    expect(postForm).toHaveBeenCalledOnce();
    await tokenVerifier.invalidate(OAUTH_ACCESS_TOKEN);
    await tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN);
    expect(postForm).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-08-20T00:00:03Z"));
    await expect(tokenVerifier.verifyAccessToken(OAUTH_ACCESS_TOKEN)).rejects.toBeInstanceOf(
      OAuthError
    );
    expect(postForm).toHaveBeenCalledTimes(3);
  });
});
