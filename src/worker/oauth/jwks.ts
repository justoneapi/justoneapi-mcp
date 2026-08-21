import { importJWK, type JWK } from "jose";

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
  if (!activeKid) throw new TypeError("OAuth Worker active kid is not configured");
  const jwk = keySet.privateKeys.get(activeKid);
  if (!jwk) throw new TypeError("OAuth Worker active kid is absent from private JWKS");
  return { kid: activeKid, key: await importJWK(jwk, "RS256") };
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
