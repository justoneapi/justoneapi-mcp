import { OAUTH_ACCESS_TOKEN_PREFIX } from "../../oauth/constants.js";
import type { ApiKeyCredentialSource } from "../../common/runtime.js";

// Datashop's long-standing public contract accepts pure alphanumeric API keys,
// and the persisted column is varchar(255). Do not narrow legacy customers to
// only the lengths produced by today's generators.
const LEGACY_API_KEY = /^[A-Za-z0-9]{1,255}$/;
const OAUTH_ACCESS_TOKEN = new RegExp(
  `^${OAUTH_ACCESS_TOKEN_PREFIX}[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`
);
const RESERVED_OAUTH_PREFIX = /^joa_[A-Za-z0-9]+_v[0-9]+_/;
const MAX_CREDENTIAL_LENGTH = 512;

export type ClassifiedCredential =
  | { kind: "none" }
  | {
      kind: "legacy";
      token: string;
      source: Exclude<ApiKeyCredentialSource, "env">;
    }
  | { kind: "oauth"; token: string; source: "authorization-bearer" }
  | {
      kind: "invalid";
      status: 400 | 401;
      reason:
        | "ambiguous_credentials"
        | "invalid_credential"
        | "malformed_authorization"
        | "oauth_requires_bearer";
    };

type InvalidReason = Extract<ClassifiedCredential, { kind: "invalid" }>["reason"];

type ParsedValue =
  | { kind: "none" }
  | { kind: "legacy"; token: string; source: Exclude<ApiKeyCredentialSource, "env"> }
  | { kind: "oauth"; token: string; source: "authorization-bearer" }
  | { kind: "invalid"; reason: InvalidReason };

export function classifyCredential(headers: Headers): ClassifiedCredential {
  const authorization = parseAuthorization(headers.get("authorization"));
  const explicit = parseExplicit(headers.get("x-justoneapi-token"));

  if (authorization.kind !== "none" && explicit.kind !== "none") {
    return { kind: "invalid", status: 400, reason: "ambiguous_credentials" };
  }

  const parsed = authorization.kind !== "none" ? authorization : explicit;
  if (parsed.kind === "none" || parsed.kind === "legacy" || parsed.kind === "oauth") {
    return parsed;
  }
  return {
    kind: "invalid",
    status: parsed.reason === "invalid_credential" ? 401 : 400,
    reason: parsed.reason,
  };
}

function parseAuthorization(value: string | null): ParsedValue {
  if (!value?.trim()) return { kind: "none" };
  const trimmed = value.trim();
  if (!isSafeCredentialValue(trimmed)) {
    return { kind: "invalid", reason: "malformed_authorization" };
  }

  const bearer = /^Bearer +([^\s,]+)$/i.exec(trimmed);
  if (bearer) return classifyToken(bearer[1], "authorization-bearer", true);
  if (/^Bearer(?:\s|$)/i.test(trimmed) || /\s/.test(trimmed)) {
    return { kind: "invalid", reason: "malformed_authorization" };
  }
  return classifyToken(trimmed, "authorization-raw", false);
}

function parseExplicit(value: string | null): ParsedValue {
  if (!value?.trim()) return { kind: "none" };
  const trimmed = value.trim();
  if (!isSafeCredentialValue(trimmed)) {
    return { kind: "invalid", reason: "invalid_credential" };
  }
  return classifyToken(trimmed, "x-header", false);
}

function classifyToken(
  token: string,
  source: Exclude<ApiKeyCredentialSource, "env">,
  bearer: boolean
): ParsedValue {
  if (OAUTH_ACCESS_TOKEN.test(token)) {
    return bearer
      ? { kind: "oauth", token, source: "authorization-bearer" }
      : { kind: "invalid", reason: "oauth_requires_bearer" };
  }
  if (RESERVED_OAUTH_PREFIX.test(token)) {
    return {
      kind: "invalid",
      reason: bearer ? "invalid_credential" : "oauth_requires_bearer",
    };
  }
  if (LEGACY_API_KEY.test(token)) return { kind: "legacy", token, source };
  return { kind: "invalid", reason: "invalid_credential" };
}

function isSafeCredentialValue(value: string): boolean {
  return (
    value.length <= MAX_CREDENTIAL_LENGTH &&
    !value.includes(",") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
