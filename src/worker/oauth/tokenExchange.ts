import { McpOAuthToolError, McpToolError } from "../../common/errors.js";
import type { DelegatedToken } from "../../common/runtime.js";
import { buildBearerChallenge } from "../../oauth/challenge.js";
import { OAUTH_DELEGATION_TOKEN_PREFIX, type McpOAuthScope } from "../../oauth/constants.js";
import {
  AuthorizationServerClient,
  AuthorizationServerRequestError,
} from "./authorizationServerClient.js";
import type { WorkerOAuthConfig } from "./config.js";
import type { IntrospectionTokenVerifier } from "./introspection.js";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const DELEGATION_TOKEN = new RegExp(
  `^${OAUTH_DELEGATION_TOKEN_PREFIX}[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`
);

export class RequestTokenExchange {
  private readonly exchanges = new Map<McpOAuthScope, Promise<DelegatedToken>>();

  constructor(
    private readonly config: WorkerOAuthConfig,
    private readonly client: AuthorizationServerClient,
    private readonly verifier: IntrospectionTokenVerifier,
    private readonly subjectToken: string
  ) {}

  exchange(scope: McpOAuthScope): Promise<DelegatedToken> {
    if (scope === "mcp:catalog:read") {
      return Promise.reject(new TypeError("Catalog tools do not use delegation tokens"));
    }
    let pending = this.exchanges.get(scope);
    if (!pending) {
      pending = this.performExchange(scope);
      this.exchanges.set(scope, pending);
      void pending.catch(() => this.exchanges.delete(scope));
    }
    return pending;
  }

  private async performExchange(scope: McpOAuthScope): Promise<DelegatedToken> {
    let payload: unknown;
    try {
      payload = await this.client.postForm(
        this.config.tokenEndpoint,
        new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: this.subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          requested_token_type: ACCESS_TOKEN_TYPE,
          resource: this.config.delegationResource,
          scope,
        })
      );
    } catch (error) {
      if (error instanceof AuthorizationServerRequestError) {
        if (error.oauthError === "invalid_grant" || error.oauthError === "invalid_token") {
          await this.verifier.invalidate(this.subjectToken);
          throw new McpOAuthToolError(
            { code: "INVALID_TOKEN", message: "OAuth access is no longer valid." },
            [
              buildBearerChallenge({
                error: "invalid_token",
                description: "The OAuth access token is expired or revoked.",
                scopes: [scope],
              }),
            ]
          );
        }
        if (error.oauthError === "invalid_scope") {
          throw new McpOAuthToolError(
            { code: "PERMISSION_DENIED", message: `OAuth scope is not available: ${scope}.` },
            [
              buildBearerChallenge({
                error: "insufficient_scope",
                description: "The requested tool scope was not granted.",
                scopes: [scope],
              }),
            ]
          );
        }
        if (error.oauthError === "invalid_target") {
          throw new McpToolError({
            code: "UPSTREAM_ERROR",
            message: "OAuth token exchange rejected the configured target resource.",
          });
        }
        throw new McpToolError({
          code: error.kind === "timeout" ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
          message: "OAuth token exchange is temporarily unavailable.",
        });
      }
      throw error;
    }

    if (!isRecord(payload)) return invalidExchangeResponse();
    const accessToken = payload.access_token;
    const issuedTokenType = payload.issued_token_type;
    const tokenType = payload.token_type;
    const expiresIn = payload.expires_in;
    const returnedScope = payload.scope;
    if (
      typeof accessToken !== "string" ||
      !DELEGATION_TOKEN.test(accessToken) ||
      issuedTokenType !== ACCESS_TOKEN_TYPE ||
      typeof tokenType !== "string" ||
      tokenType.toLowerCase() !== "bearer" ||
      returnedScope !== scope ||
      "refresh_token" in payload ||
      typeof expiresIn !== "number" ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > 120
    ) {
      return invalidExchangeResponse();
    }
    return {
      token: accessToken,
      expiresAt: Math.floor(Date.now() / 1_000) + expiresIn,
    };
  }
}

function invalidExchangeResponse(): never {
  throw new McpToolError({
    code: "UPSTREAM_ERROR",
    message: "OAuth token exchange returned an invalid response.",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
