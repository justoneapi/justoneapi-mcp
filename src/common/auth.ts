export function parseAuthToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization?.trim()) {
    const value = authorization.trim();
    if (value.toLowerCase().startsWith("bearer ")) {
      const token = value.slice(7).trim();
      return token || null;
    }
    return value;
  }

  const explicit = headers.get("x-justoneapi-token");
  return explicit?.trim() || null;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function tokenHash(token: string | null | undefined): Promise<string | undefined> {
  if (!token) return undefined;
  return (await sha256Hex(token)).slice(0, 12);
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
