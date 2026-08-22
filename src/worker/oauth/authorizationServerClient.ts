import { SignJWT } from "jose";
import type { WorkerOAuthConfig } from "./config.js";
import { importActiveSigningKey, type ParsedPrivateJwkSet } from "./jwks.js";

const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const MAX_AUTHORIZATION_SERVER_RESPONSE_BYTES = 64 * 1024;

export class AuthorizationServerRequestError extends Error {
  readonly kind: "network" | "timeout" | "http" | "invalid_response";
  readonly status?: number;
  readonly oauthError?: string;

  constructor(
    kind: AuthorizationServerRequestError["kind"],
    message: string,
    options: { status?: number; oauthError?: string } = {}
  ) {
    super(message);
    this.kind = kind;
    this.status = options.status;
    this.oauthError = options.oauthError;
  }
}

export class AuthorizationServerClient {
  private signingKey?: Promise<{ kid: string; key: CryptoKey | Uint8Array }>;

  constructor(
    private readonly config: WorkerOAuthConfig,
    private readonly keySet: ParsedPrivateJwkSet
  ) {}

  async postForm(endpoint: string, parameters: URLSearchParams): Promise<unknown> {
    if (endpoint !== this.config.tokenEndpoint && endpoint !== this.config.introspectionEndpoint) {
      throw new TypeError("Authorization Server endpoint is not allowlisted");
    }
    const form = new URLSearchParams(parameters);
    form.set("client_id", this.config.clientId);
    form.set("client_assertion_type", CLIENT_ASSERTION_TYPE);
    form.set("client_assertion", await this.createClientAssertion(endpoint));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.authorizationServerTimeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      const timeout = error instanceof Error && error.name === "AbortError";
      throw new AuthorizationServerRequestError(
        timeout ? "timeout" : "network",
        timeout ? "Authorization Server request timed out" : "Authorization Server request failed"
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = await readJsonObject(response);
    if (!response.ok) {
      throw new AuthorizationServerRequestError("http", "Authorization Server rejected request", {
        status: response.status,
        oauthError: typeof payload.error === "string" ? payload.error : undefined,
      });
    }
    return payload;
  }

  private async createClientAssertion(audience: string): Promise<string> {
    this.signingKey ??= importActiveSigningKey(this.keySet, this.config.activeKid);
    const { kid, key } = await this.signingKey;
    const now = Math.floor(Date.now() / 1_000);
    return await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(this.config.clientId)
      .setSubject(this.config.clientId)
      .setAudience(audience)
      .setIssuedAt(now)
      .setNotBefore(now - 5)
      .setExpirationTime(now + 60)
      .setJti(crypto.randomUUID())
      .sign(key);
  }
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTHORIZATION_SERVER_RESPONSE_BYTES) {
    throw new AuthorizationServerRequestError(
      "invalid_response",
      "Authorization Server response is too large",
      { status: response.status }
    );
  }

  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTHORIZATION_SERVER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AuthorizationServerRequestError(
          "invalid_response",
          "Authorization Server response is too large",
          { status: response.status }
        );
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AuthorizationServerRequestError(
      "invalid_response",
      "Authorization Server response is not valid JSON",
      { status: response.status }
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AuthorizationServerRequestError(
      "invalid_response",
      "Authorization Server response must be an object",
      { status: response.status }
    );
  }
  return parsed as Record<string, unknown>;
}
