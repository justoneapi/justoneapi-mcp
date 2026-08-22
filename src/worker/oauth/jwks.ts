import { CompactSign, compactVerify, importJWK, type JWK } from "jose";

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

export type PublicRsaJwk = {
  kty: "RSA";
  kid: string;
  use: "sig";
  alg: "RS256";
  n: string;
  e: string;
};

export type ParsedPrivateJwkSet = {
  privateKeys: ReadonlyMap<string, JWK>;
  publicJwks: { keys: PublicRsaJwk[] };
};

export type OAuthSigningConfigurationFailure =
  | "private_jwks_missing"
  | "private_jwks_invalid"
  | "active_kid_missing"
  | "active_kid_not_found"
  | "signing_key_import_failed"
  | "signing_key_verification_failed";

export class OAuthSigningConfigurationError extends Error {
  constructor(
    readonly code: OAuthSigningConfigurationFailure,
    message: string
  ) {
    super(message);
    this.name = "OAuthSigningConfigurationError";
  }
}

export function parsePrivateJwkSet(raw: string | undefined): ParsedPrivateJwkSet {
  if (!raw) throw new TypeError("OAuth Worker private JWKS is not configured");
  if (raw.length > 128 * 1024) throw new TypeError("OAuth Worker private JWKS is too large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("OAuth Worker private JWKS is not valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.keys) || !parsed.keys.length) {
    throw new TypeError("OAuth Worker private JWKS must contain keys");
  }
  if (parsed.keys.length > 5) throw new TypeError("OAuth Worker private JWKS has too many keys");

  const privateKeys = new Map<string, JWK>();
  const publicKeys: PublicRsaJwk[] = [];
  for (const candidate of parsed.keys) {
    const key = validatePrivateRsaJwk(candidate);
    if (privateKeys.has(key.kid)) throw new TypeError("OAuth Worker JWKS has duplicate kid");
    privateKeys.set(key.kid, key);
    publicKeys.push({
      kty: "RSA",
      kid: key.kid,
      use: "sig",
      alg: "RS256",
      n: key.n,
      e: key.e,
    });
  }
  publicKeys.sort((left, right) => left.kid.localeCompare(right.kid));
  return { privateKeys, publicJwks: { keys: publicKeys } };
}

export async function importActiveSigningKey(
  keySet: ParsedPrivateJwkSet,
  activeKid: string | undefined
): Promise<{ kid: string; key: CryptoKey | Uint8Array }> {
  if (!activeKid) {
    throw new OAuthSigningConfigurationError(
      "active_kid_missing",
      "OAuth Worker active kid is not configured"
    );
  }
  const jwk = keySet.privateKeys.get(activeKid);
  if (!jwk) {
    throw new OAuthSigningConfigurationError(
      "active_kid_not_found",
      "OAuth Worker active kid is absent from private JWKS"
    );
  }
  try {
    return { kid: activeKid, key: await importJWK(jwk, "RS256") };
  } catch {
    throw new OAuthSigningConfigurationError(
      "signing_key_import_failed",
      "OAuth Worker active signing key could not be imported"
    );
  }
}

export async function verifyActiveSigningKey(
  keySet: ParsedPrivateJwkSet,
  activeKid: string | undefined
): Promise<void> {
  const { kid, key } = await importActiveSigningKey(keySet, activeKid);
  const publicJwk = keySet.publicJwks.keys.find((candidate) => candidate.kid === kid);
  if (!publicJwk) {
    throw new OAuthSigningConfigurationError(
      "active_kid_not_found",
      "OAuth Worker active kid is absent from public JWKS"
    );
  }
  const payload = new TextEncoder().encode("justoneapi-oauth-worker-signing-readiness-v1");
  try {
    const publicKey = await importJWK(publicJwk, "RS256");
    const signature = await new CompactSign(payload)
      .setProtectedHeader({ alg: "RS256", kid })
      .sign(key);
    const verified = await compactVerify(signature, publicKey, { algorithms: ["RS256"] });
    if (!bytesEqual(verified.payload, payload)) throw new Error("payload mismatch");
  } catch {
    throw new OAuthSigningConfigurationError(
      "signing_key_verification_failed",
      "OAuth Worker active signing key failed local verification"
    );
  }
}

export function normalizePrivateJwkSetError(error: unknown): OAuthSigningConfigurationError {
  if (error instanceof OAuthSigningConfigurationError) return error;
  const missing =
    error instanceof Error && error.message === "OAuth Worker private JWKS is not configured";
  return new OAuthSigningConfigurationError(
    missing ? "private_jwks_missing" : "private_jwks_invalid",
    missing ? "OAuth Worker private JWKS is not configured" : "OAuth Worker private JWKS is invalid"
  );
}

function validatePrivateRsaJwk(value: unknown): JWK & {
  kid: string;
  n: string;
  e: string;
} {
  if (!isRecord(value)) throw new TypeError("OAuth Worker JWKS key is invalid");
  if (value.kty !== "RSA" || (value.alg !== undefined && value.alg !== "RS256")) {
    throw new TypeError("OAuth Worker JWKS keys must use RSA/RS256");
  }
  if (value.use !== undefined && value.use !== "sig") {
    throw new TypeError("OAuth Worker JWKS keys must be signing keys");
  }
  if (typeof value.kid !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(value.kid)) {
    throw new TypeError("OAuth Worker JWKS key kid is invalid");
  }
  if (typeof value.n !== "string" || !value.n || typeof value.e !== "string" || !value.e) {
    throw new TypeError("OAuth Worker JWKS RSA public parameters are invalid");
  }
  for (const field of PRIVATE_JWK_FIELDS) {
    if (typeof value[field] !== "string" || !value[field]) {
      throw new TypeError("OAuth Worker JWKS RSA private parameters are incomplete");
    }
  }
  return value as JWK & { kid: string; n: string; e: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
