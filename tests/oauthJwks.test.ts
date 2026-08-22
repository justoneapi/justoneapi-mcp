import { describe, expect, it } from "vitest";
import {
  importActiveSigningKey,
  parsePrivateJwkSet,
  verifyActiveSigningKey,
} from "../src/worker/oauth/jwks.js";
import { createPrivateJwks } from "./oauthFixtures.js";

describe("Worker private JWKS", () => {
  it("publishes only sorted public RSA fields and supports overlapping rotation keys", async () => {
    const fixture = await createPrivateJwks(["z-old", "a-new"]);
    const parsed = parsePrivateJwkSet(fixture.raw);
    expect(parsed.publicJwks.keys.map((key) => key.kid)).toEqual(["a-new", "z-old"]);
    for (const key of parsed.publicJwks.keys) {
      expect(Object.keys(key).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
      expect(key).not.toHaveProperty("d");
      expect(key).not.toHaveProperty("p");
      expect(key).not.toHaveProperty("q");
    }
    await expect(importActiveSigningKey(parsed, "z-old")).resolves.toMatchObject({
      kid: "z-old",
    });
    await expect(importActiveSigningKey(parsed, "a-new")).resolves.toMatchObject({
      kid: "a-new",
    });
    await expect(verifyActiveSigningKey(parsed, "a-new")).resolves.toBeUndefined();
  });

  it("rejects an RSA private JWK that imports but cannot verify against its public fields", async () => {
    const fixture = await createPrivateJwks(["active"]);
    const key = fixture.keys[0];
    const finalCharacter = key.n?.at(-1);
    if (!key.n || !finalCharacter) throw new Error("fixture modulus is missing");
    const mutated = {
      ...key,
      n: `${key.n.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`,
    };
    const parsed = parsePrivateJwkSet(JSON.stringify({ keys: [mutated] }));
    await expect(verifyActiveSigningKey(parsed, "active")).rejects.toMatchObject({
      code: "signing_key_verification_failed",
    });
  });

  it("fails closed for duplicate, incomplete, absent, or unknown signing keys", async () => {
    const fixture = await createPrivateJwks(["only"]);
    const key = fixture.keys[0];
    expect(() => parsePrivateJwkSet(JSON.stringify({ keys: [key, key] }))).toThrow("duplicate kid");
    const { d: _d, ...publicOnly } = key;
    expect(() => parsePrivateJwkSet(JSON.stringify({ keys: [publicOnly] }))).toThrow(
      "private parameters"
    );
    expect(() => parsePrivateJwkSet(undefined)).toThrow("not configured");
    const parsed = parsePrivateJwkSet(fixture.raw);
    await expect(importActiveSigningKey(parsed, undefined)).rejects.toThrow("not configured");
    await expect(importActiveSigningKey(parsed, "missing")).rejects.toThrow("absent");
  });

  it("bounds the number and serialized size of private keys", async () => {
    const fixture = await createPrivateJwks(["one"]);
    expect(() =>
      parsePrivateJwkSet(JSON.stringify({ keys: Array.from({ length: 6 }, () => fixture.keys[0]) }))
    ).toThrow("too many keys");
    expect(() => parsePrivateJwkSet("x".repeat(128 * 1024 + 1))).toThrow("too large");
  });
});
