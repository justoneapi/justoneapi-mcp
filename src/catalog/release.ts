import { createHash } from "node:crypto";
import { CatalogBundle, CatalogReleaseAttestation, CatalogSafetyContext } from "./types.js";

const RELEASE_ID_RE = /^[a-z0-9._-]+$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;

export const CATALOG_SAFETY_POLICY_VERSION = "2026-07-16.1";

export class CatalogSafetyContextMismatchError extends Error {
  constructor() {
    super("Catalog safety policy revision mismatch");
    this.name = "CatalogSafetyContextMismatchError";
  }
}

export function assertReleaseId(releaseId: string): void {
  if (!RELEASE_ID_RE.test(releaseId)) throw new Error("Invalid catalog release_id");
}

export function catalogSafetyContext(): CatalogSafetyContext {
  return {
    safety_policy_version: CATALOG_SAFETY_POLICY_VERSION,
  };
}

export function catalogBundleSha256(bundle: CatalogBundle): string {
  return sha256(JSON.stringify(bundle));
}

export function catalogReleaseAttestation(bundle: CatalogBundle): CatalogReleaseAttestation {
  const safety = catalogSafetyContext();
  assertPromotedCatalogBundle(bundle);
  assertCatalogSafetyContext(bundle.meta.security, safety);
  return {
    release_id: bundle.meta.release_id!,
    content_sha256: catalogBundleSha256(bundle),
    ...safety,
  };
}

/**
 * Validate the small release envelope that is safe to check on every cold
 * load. The complete public-safety scan happens before promotion; the
 * versioned pointer, content digest, and policy version prove which immutable
 * release crossed that boundary.
 */
export function assertPromotedCatalogBundle(
  bundle: CatalogBundle,
  expectedReleaseId?: string
): void {
  const releaseId = bundle.meta?.release_id;
  if (!releaseId) throw new Error("Promoted catalog has no release_id");
  assertReleaseId(releaseId);
  if (expectedReleaseId !== undefined && releaseId !== expectedReleaseId) {
    throw new Error("Promoted catalog release mismatch");
  }
  if (!Array.isArray(bundle.catalog?.endpoints) || bundle.catalog.endpoints.length === 0) {
    throw new Error("Promoted catalog is empty");
  }
  if (
    !Number.isInteger(bundle.meta.endpoint_count) ||
    bundle.meta.endpoint_count !== bundle.catalog.endpoints.length
  ) {
    throw new Error("Promoted catalog endpoint count mismatch");
  }
}

export function assertCatalogReleaseAttestation(value: CatalogReleaseAttestation): void {
  assertReleaseId(value.release_id);
  if (!SHA256_RE.test(value.content_sha256)) {
    throw new Error("Invalid catalog release content digest");
  }
  if (!value.safety_policy_version) {
    throw new Error("Invalid catalog release safety attestation");
  }
}

export function assertCatalogSafetyContext(
  actual: CatalogSafetyContext | undefined,
  expected: CatalogSafetyContext
): void {
  if (!actual || actual.safety_policy_version !== expected.safety_policy_version) {
    throw new CatalogSafetyContextMismatchError();
  }
}

export function catalogSafetyContextsEqual(
  left: CatalogSafetyContext,
  right: CatalogSafetyContext
): boolean {
  return left.safety_policy_version === right.safety_policy_version;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
