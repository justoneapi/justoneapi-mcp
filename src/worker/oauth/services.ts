import { sha256Hex } from "../../common/auth.js";
import { AuthorizationServerClient } from "./authorizationServerClient.js";
import type { WorkerOAuthConfig } from "./config.js";
import { IntrospectionTokenVerifier } from "./introspection.js";
import { parsePrivateJwkSet, type ParsedPrivateJwkSet } from "./jwks.js";
import { RequestTokenExchange } from "./tokenExchange.js";

export type WorkerOAuthServices = {
  keySet: ParsedPrivateJwkSet;
  client: AuthorizationServerClient;
  verifier: IntrospectionTokenVerifier;
  createExchange(subjectToken: string): RequestTokenExchange;
};

let cachedServices: { key: string; value: WorkerOAuthServices } | undefined;

/**
 * Cache immutable signing material and the positive introspection cache at the
 * Worker-isolate level. Delegation exchange memoization must remain request
 * local because a delegation token is single-use.
 */
export async function getWorkerOAuthServices(
  config: WorkerOAuthConfig
): Promise<WorkerOAuthServices> {
  const privateJwks = config.privateJwks;
  if (!privateJwks) throw new TypeError("OAuth Worker private JWKS is not configured");
  const jwksDigest = await sha256Hex(privateJwks);
  const key = JSON.stringify({
    jwksDigest,
    activeKid: config.activeKid,
    clientId: config.clientId,
    tokenEndpoint: config.tokenEndpoint,
    introspectionEndpoint: config.introspectionEndpoint,
    timeout: config.authorizationServerTimeoutMs,
    cacheTtl: config.introspectionCacheTtlMs,
    cacheMax: config.introspectionCacheMaxEntries,
  });
  if (cachedServices?.key === key) return cachedServices.value;

  const keySet = parsePrivateJwkSet(privateJwks);
  const client = new AuthorizationServerClient(config, keySet);
  const verifier = new IntrospectionTokenVerifier(config, client);
  const value: WorkerOAuthServices = {
    keySet,
    client,
    verifier,
    createExchange(subjectToken) {
      return new RequestTokenExchange(config, client, verifier, subjectToken);
    },
  };
  cachedServices = { key, value };
  return value;
}

export function clearWorkerOAuthServicesForTests(): void {
  cachedServices = undefined;
}
