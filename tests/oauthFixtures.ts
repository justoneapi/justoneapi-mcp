import { exportJWK, generateKeyPair, type JWK } from "jose";

export const OAUTH_ACCESS_TOKEN = `joa_at_v1_${"a".repeat(22)}.${"b".repeat(43)}`;
export const OAUTH_DELEGATION_TOKEN = `joa_dt_v1_${"c".repeat(22)}.${"d".repeat(43)}`;

export async function createPrivateJwks(kids: string[] = ["test-key-1"]): Promise<{
  raw: string;
  keys: JWK[];
}> {
  const keys: JWK[] = [];
  for (const kid of kids) {
    const { privateKey } = await generateKeyPair("RS256", {
      extractable: true,
      modulusLength: 2048,
    });
    keys.push({
      ...(await exportJWK(privateKey)),
      kid,
      alg: "RS256",
      use: "sig",
    });
  }
  return { raw: JSON.stringify({ keys }), keys };
}

export function activeIntrospectionPayload(
  scopes: string = "mcp:catalog:read"
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1_000);
  return {
    active: true,
    client_id: "chatgpt-client",
    sub: "user-1",
    connection_id: "connection-1",
    scope: scopes,
    exp: now + 300,
    iat: now - 5,
    nbf: now - 5,
    iss: "https://auth.justoneapi.com",
    aud: "https://mcp.justoneapi.com/mcp",
    token_type: "Bearer",
  };
}
