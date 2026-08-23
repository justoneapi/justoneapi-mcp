import { SignJWT } from "jose";
import type { WorkerOAuthConfig } from "./config.js";
import { importActiveSigningKey, type ParsedPrivateJwkSet } from "./jwks.js";

const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const MAX_AUTHORIZATION_SERVER_RESPONSE_BYTES = 64 * 1024;

const SAFE_NETWORK_ERROR_NAMES = ["Error", "NetworkError", "TypeError"] as const;
const SAFE_NETWORK_CAUSE_CODES = [
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ETIMEDOUT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
] as const;

type SafeNetworkErrorName = (typeof SAFE_NETWORK_ERROR_NAMES)[number];
type SafeNetworkCauseCode = (typeof SAFE_NETWORK_CAUSE_CODES)[number];

export class AuthorizationServerRequestError extends Error {
  readonly kind: "network" | "timeout" | "redirect" | "http" | "invalid_response";
  readonly status?: number;
  readonly oauthError?: string;
  readonly networkErrorName?: SafeNetworkErrorName;
  readonly networkCauseCode?: SafeNetworkCauseCode;

  constructor(
    kind: AuthorizationServerRequestError["kind"],
    message: string,
    options: {
      status?: number;
      oauthError?: string;
      networkErrorName?: SafeNetworkErrorName;
      networkCauseCode?: SafeNetworkCauseCode;
    } = {}
  ) {
    super(message);
    this.kind = kind;
    this.status = options.status;
    this.oauthError = options.oauthError;
    this.networkErrorName = options.networkErrorName;
    this.networkCauseCode = options.networkCauseCode;
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
    let response: Response | undefined;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        throw new AuthorizationServerRequestError(
          "redirect",
          "Authorization Server redirected request",
          { status: response.status }
        );
      }

      const payload = await readJsonObject(response);
      if (!response.ok) {
        throw new AuthorizationServerRequestError("http", "Authorization Server rejected request", {
          status: response.status,
          oauthError: typeof payload.error === "string" ? payload.error : undefined,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AuthorizationServerRequestError) throw error;
      const timeout =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const diagnostics = timeout ? {} : safeNetworkDiagnostics(error);
      throw new AuthorizationServerRequestError(
        timeout ? "timeout" : "network",
        timeout ? "Authorization Server request timed out" : "Authorization Server request failed",
        {
          ...(response ? { status: response.status } : {}),
          ...diagnostics,
        }
      );
    } finally {
      clearTimeout(timer);
    }
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

function safeNetworkDiagnostics(error: unknown): {
  networkErrorName?: SafeNetworkErrorName;
  networkCauseCode?: SafeNetworkCauseCode;
} {
  if (!(error instanceof Error)) return {};
  const networkErrorName = isSafeValue(error.name, SAFE_NETWORK_ERROR_NAMES)
    ? error.name
    : undefined;
  const cause = error.cause;
  const causeCode =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  const networkCauseCode = isSafeValue(causeCode, SAFE_NETWORK_CAUSE_CODES) ? causeCode : undefined;
  return {
    ...(networkErrorName ? { networkErrorName } : {}),
    ...(networkCauseCode ? { networkCauseCode } : {}),
  };
}

function isSafeValue<const T extends readonly string[]>(
  value: unknown,
  allowlist: T
): value is T[number] {
  return typeof value === "string" && (allowlist as readonly string[]).includes(value);
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
