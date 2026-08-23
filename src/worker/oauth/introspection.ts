import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { sha256Hex } from "../../common/auth.js";
import { MCP_OAUTH_SCOPES } from "../../oauth/constants.js";
import type { WorkerOAuthConfig } from "./config.js";
import {
  AuthorizationServerClient,
  AuthorizationServerRequestError,
} from "./authorizationServerClient.js";

type CachedAuthInfo = Omit<AuthInfo, "token" | "resource"> & {
  resource: string;
};

type CacheEntry = {
  value: CachedAuthInfo;
  validUntilMs: number;
};

export class OAuthInfrastructureError extends Error {
  readonly code: "authorization_server_unavailable" | "authorization_server_contract_error";
  readonly upstreamKind?: AuthorizationServerRequestError["kind"];
  readonly upstreamStatus?: number;
  readonly upstreamErrorName?: AuthorizationServerRequestError["networkErrorName"];
  readonly upstreamCauseCode?: AuthorizationServerRequestError["networkCauseCode"];

  constructor(
    code: OAuthInfrastructureError["code"],
    options: {
      upstreamKind?: AuthorizationServerRequestError["kind"];
      upstreamStatus?: number;
      upstreamErrorName?: AuthorizationServerRequestError["networkErrorName"];
      upstreamCauseCode?: AuthorizationServerRequestError["networkCauseCode"];
    } = {}
  ) {
    super(code);
    this.code = code;
    this.upstreamKind = options.upstreamKind;
    this.upstreamStatus = options.upstreamStatus;
    this.upstreamErrorName = options.upstreamErrorName;
    this.upstreamCauseCode = options.upstreamCauseCode;
  }
}

export class IntrospectionTokenVerifier implements OAuthTokenVerifier {
  private readonly positiveCache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<CachedAuthInfo>>();

  constructor(
    private readonly config: WorkerOAuthConfig,
    private readonly client: AuthorizationServerClient
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenDigest = await sha256Hex(token);
    const now = Date.now();
    const cached = this.positiveCache.get(tokenDigest);
    if (cached && cached.validUntilMs > now) {
      this.positiveCache.delete(tokenDigest);
      this.positiveCache.set(tokenDigest, cached);
      return hydrateAuthInfo(token, cached.value);
    }
    if (cached) this.positiveCache.delete(tokenDigest);

    let pending = this.inFlight.get(tokenDigest);
    if (!pending) {
      pending = this.introspect(token, tokenDigest);
      this.inFlight.set(tokenDigest, pending);
      void pending.finally(() => this.inFlight.delete(tokenDigest)).catch(() => {});
    }
    const value = await pending;
    this.cachePositive(tokenDigest, value);
    return hydrateAuthInfo(token, value);
  }

  async invalidate(token: string): Promise<void> {
    this.positiveCache.delete(await sha256Hex(token));
  }

  private async introspect(token: string, tokenDigest: string): Promise<CachedAuthInfo> {
    let payload: unknown;
    try {
      payload = await this.client.postForm(
        this.config.introspectionEndpoint,
        new URLSearchParams({ token, token_type_hint: "access_token" })
      );
    } catch (error) {
      if (error instanceof AuthorizationServerRequestError) {
        throw new OAuthInfrastructureError("authorization_server_unavailable", {
          upstreamKind: error.kind,
          upstreamStatus: error.status,
          upstreamErrorName: error.networkErrorName,
          upstreamCauseCode: error.networkCauseCode,
        });
      }
      throw error;
    }
    if (!isRecord(payload) || typeof payload.active !== "boolean") {
      throw new OAuthInfrastructureError("authorization_server_contract_error");
    }
    if (!payload.active) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is inactive");
    }

    const clientId = requiredString(payload.client_id);
    const subject = requiredString(payload.sub);
    const connectionId = requiredString(payload.connection_id);
    const scopes = parseScopes(payload.scope);
    const expiresAt = requiredEpoch(payload.exp);
    const issuedAt = requiredEpoch(payload.iat);
    const notBefore = optionalEpoch(payload.nbf);
    const issuer = requiredString(payload.iss);
    if (
      !clientId ||
      !subject ||
      !connectionId ||
      !scopes ||
      !expiresAt ||
      !issuedAt ||
      !issuer ||
      notBefore === null
    ) {
      throw new OAuthInfrastructureError("authorization_server_contract_error");
    }
    if (issuer !== this.config.issuer || !audienceIsExact(payload.aud, this.config.resource)) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "Access token has the wrong issuer or audience"
      );
    }
    if (
      payload.token_type !== undefined &&
      (typeof payload.token_type !== "string" || payload.token_type.toLowerCase() !== "bearer")
    ) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token type is invalid");
    }
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      expiresAt <= nowSeconds ||
      issuedAt > nowSeconds + 60 ||
      issuedAt >= expiresAt ||
      (notBefore !== undefined && (notBefore > nowSeconds + 60 || notBefore >= expiresAt))
    ) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token has expired");
    }

    return {
      clientId,
      scopes,
      expiresAt,
      resource: this.config.resource,
      extra: {
        subject,
        connectionId,
        tokenHash: tokenDigest,
      },
    };
  }

  private cachePositive(tokenDigest: string, value: CachedAuthInfo): void {
    if (this.config.introspectionCacheTtlMs <= 0) return;
    const now = Date.now();
    const validUntilMs = Math.min(
      now + this.config.introspectionCacheTtlMs,
      value.expiresAt === undefined ? now : value.expiresAt * 1_000
    );
    if (validUntilMs <= now) return;
    this.positiveCache.delete(tokenDigest);
    while (this.positiveCache.size >= this.config.introspectionCacheMaxEntries) {
      const oldest = this.positiveCache.keys().next().value;
      if (typeof oldest !== "string") break;
      this.positiveCache.delete(oldest);
    }
    this.positiveCache.set(tokenDigest, { value, validUntilMs });
  }
}

function hydrateAuthInfo(token: string, cached: CachedAuthInfo): AuthInfo {
  return {
    ...cached,
    token,
    resource: new URL(cached.resource),
    scopes: [...cached.scopes],
    extra: cached.extra ? { ...cached.extra } : undefined,
  };
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredEpoch(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalEpoch(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseScopes(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const scopes = value.split(/ +/).filter(Boolean);
  if (!scopes.length || scopes.some((scope) => !MCP_OAUTH_SCOPES.includes(scope as never))) {
    return null;
  }
  return [...new Set(scopes)];
}

function audienceIsExact(value: unknown, expected: string): boolean {
  return (
    value === expected || (Array.isArray(value) && value.length === 1 && value[0] === expected)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
