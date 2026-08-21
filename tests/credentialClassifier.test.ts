import { describe, expect, it } from "vitest";
import { classifyCredential } from "../src/worker/auth/credentialClassifier.js";

const ACCESS_TOKEN = `joa_at_v1_${"a".repeat(22)}.${"b".repeat(43)}`;

function classify(headers: Record<string, string>) {
  return classifyCredential(new Headers(headers));
}

describe("Worker credential classifier", () => {
  it("accepts the full persisted legacy API-key contract from every legacy location", () => {
    for (const length of [1, 8, 16, 24, 32, 255]) {
      const token = "A".repeat(length);
      expect(classify({ authorization: `Bearer ${token}` })).toEqual({
        kind: "legacy",
        token,
        source: "authorization-bearer",
      });
      expect(classify({ authorization: token })).toEqual({
        kind: "legacy",
        token,
        source: "authorization-raw",
      });
      expect(classify({ "x-justoneapi-token": token })).toEqual({
        kind: "legacy",
        token,
        source: "x-header",
      });
    }
  });

  it("accepts an OAuth access token only as an Authorization Bearer credential", () => {
    expect(classify({ authorization: `Bearer ${ACCESS_TOKEN}` })).toEqual({
      kind: "oauth",
      token: ACCESS_TOKEN,
      source: "authorization-bearer",
    });
    expect(classify({ authorization: ACCESS_TOKEN })).toMatchObject({
      kind: "invalid",
      status: 400,
      reason: "oauth_requires_bearer",
    });
    expect(classify({ "x-justoneapi-token": ACCESS_TOKEN })).toMatchObject({
      kind: "invalid",
      status: 400,
      reason: "oauth_requires_bearer",
    });
  });

  it("rejects two credential locations unconditionally, including identical values", () => {
    for (const explicit of ["A".repeat(16), "B".repeat(16)]) {
      expect(
        classify({ authorization: `Bearer ${"A".repeat(16)}`, "x-justoneapi-token": explicit })
      ).toEqual({ kind: "invalid", status: 400, reason: "ambiguous_credentials" });
    }
  });

  it.each([
    ["legacy value beyond the persisted limit", { authorization: "A".repeat(256) }, 401],
    ["malformed bearer", { authorization: "Bearer" }, 400],
    ["comma concatenation", { authorization: `Bearer ${"A".repeat(16)},x` }, 400],
    ["embedded whitespace", { authorization: `${"A".repeat(8)} ${"B".repeat(8)}` }, 400],
    ["overlong value", { authorization: "A".repeat(513) }, 400],
    ["malformed reserved access token", { authorization: "Bearer joa_at_v1_bad" }, 401],
    ["future reserved token", { authorization: "joa_other_v9_bad" }, 400],
  ])("rejects %s", (_name, headers, status) => {
    expect(classify(headers)).toMatchObject({ kind: "invalid", status });
  });

  it("reports no credential for absent or whitespace-only headers", () => {
    expect(classify({})).toEqual({ kind: "none" });
    expect(classify({ authorization: " ", "x-justoneapi-token": " " })).toEqual({
      kind: "none",
    });
  });
});
