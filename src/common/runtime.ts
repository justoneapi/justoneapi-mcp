import { AppConfig } from "../config.js";
import { CatalogManager } from "../catalog/manager.js";
import { Logger } from "./logger.js";
import { McpOAuthToolError, McpToolError } from "./errors.js";
import { tokenHash } from "./auth.js";
import { buildBearerChallenge } from "../oauth/challenge.js";
import type { McpOAuthScope } from "../oauth/constants.js";

type BaseRuntimeContext = {
  config: AppConfig;
  catalogManager: CatalogManager;
  logger: Logger;
};

export type ApiKeyCredentialSource =
  | "env"
  | "authorization-bearer"
  | "authorization-raw"
  | "x-header";

export type StdioRuntimeContext = BaseRuntimeContext & {
  transport: "stdio";
  auth: {
    kind: "api-key";
    source: "env";
    token: string;
  };
};

export type WorkerLegacyRuntimeContext = BaseRuntimeContext & {
  transport: "worker";
  oauthAdvertised: boolean;
  auth: {
    kind: "api-key";
    source: Exclude<ApiKeyCredentialSource, "env">;
    token: string;
  };
};

export type WorkerAnonymousRuntimeContext = BaseRuntimeContext & {
  transport: "worker";
  oauthAdvertised: boolean;
  auth: {
    kind: "none";
  };
};

export type DelegatedToken = {
  token: string;
  expiresAt: number;
};

export type UpstreamCredential =
  | { kind: "api-key"; token: string }
  | { kind: "oauth-delegation"; bearerToken: string; expiresAt: number };

export type WorkerOAuthRuntimeContext = BaseRuntimeContext & {
  transport: "worker";
  oauthAdvertised: true;
  auth: {
    kind: "oauth";
    accessToken: string;
    accessTokenHash: string;
    clientId: string;
    subject: string;
    connectionId: string;
    scopes: ReadonlySet<McpOAuthScope>;
    exchange(scope: McpOAuthScope): Promise<DelegatedToken>;
  };
};

export type RuntimeContext =
  | StdioRuntimeContext
  | WorkerLegacyRuntimeContext
  | WorkerAnonymousRuntimeContext
  | WorkerOAuthRuntimeContext;

export function authorizeScope(ctx: RuntimeContext, scope: McpOAuthScope): void {
  if (ctx.auth.kind === "none") {
    throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
  }
  if (ctx.auth.kind === "oauth" && !ctx.auth.scopes.has(scope)) {
    throw new McpOAuthToolError(
      {
        code: "PERMISSION_DENIED",
        message: `OAuth access token is missing required scope: ${scope}.`,
      },
      [
        buildBearerChallenge({
          error: "insufficient_scope",
          description: "The access token does not include the required tool scope.",
          scopes: [scope],
        }),
      ]
    );
  }
}

export async function resolveUpstreamCredential(
  ctx: RuntimeContext,
  scope: McpOAuthScope
): Promise<UpstreamCredential> {
  authorizeScope(ctx, scope);
  if (ctx.auth.kind === "oauth") {
    const delegated = await ctx.auth.exchange(scope);
    return {
      kind: "oauth-delegation",
      bearerToken: delegated.token,
      expiresAt: delegated.expiresAt,
    };
  }
  if (ctx.auth.kind === "api-key") return { kind: "api-key", token: ctx.auth.token };
  throw new McpToolError({ code: "AUTH_REQUIRED", message: "Missing JustOneAPI token." });
}

export async function runtimeTokenHash(ctx: RuntimeContext): Promise<string | undefined> {
  if (ctx.auth.kind === "oauth") return ctx.auth.accessTokenHash.slice(0, 12);
  if (ctx.auth.kind === "api-key") return await tokenHash(ctx.auth.token);
  return undefined;
}
