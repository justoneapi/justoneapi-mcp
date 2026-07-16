import {
  CatalogBundle,
  CatalogReleaseAttestation,
  CatalogSafetyContext,
  CatalogStore,
} from "../catalog/types.js";
import {
  assertCatalogReleaseAttestation,
  assertCatalogSafetyContext,
  assertPromotedCatalogBundle,
  assertReleaseId,
  catalogBundleSha256,
  catalogSafetyContextsEqual,
} from "../catalog/release.js";

const BUNDLE_KEY = "catalog:bundle";
const LAST_REFRESH_KEY = "catalog:last-refresh";
const LOCK_KEY = "catalog:refresh-lock";
const POINTERS_KEY = "catalog:pointers";
const RELEASE_PREFIX = "catalog:release:";
const POINTER_SCHEMA_VERSION = 2;

type CatalogPointersV2 = {
  schema_version: typeof POINTER_SCHEMA_VERSION;
  active?: CatalogReleaseAttestation;
  previous?: CatalogReleaseAttestation;
  candidate?: string;
};

export class KvCatalogStore implements CatalogStore {
  constructor(private readonly kv: KVNamespace) {}

  async load(): Promise<CatalogBundle | null> {
    return await this.loadActive();
  }

  async save(bundle: CatalogBundle): Promise<void> {
    await this.kv.put(BUNDLE_KEY, JSON.stringify(bundle));
  }

  async loadPromoted(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointersV2();
    return pointers?.active ? await this.readAttestedRelease(pointers.active, safety) : null;
  }

  async loadActive(): Promise<CatalogBundle | null> {
    const raw = await this.kv.get<Record<string, unknown>>(POINTERS_KEY, "json");
    const releaseId = activeReleaseId(raw);
    return releaseId
      ? await this.readRelease(releaseId)
      : await this.kv.get<CatalogBundle>(BUNDLE_KEY, "json");
  }

  async loadPrevious(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointersV2();
    return pointers?.previous ? await this.readAttestedRelease(pointers.previous, safety) : null;
  }

  async loadCandidate(): Promise<CatalogBundle | null> {
    const pointers = await this.readPointersV2();
    return pointers?.candidate ? await this.readRelease(pointers.candidate) : null;
  }

  async saveCandidate(bundle: CatalogBundle): Promise<void> {
    const releaseId = requiredReleaseId(bundle);
    const existing = await this.readRelease(releaseId);
    if (existing && catalogBundleSha256(existing) !== catalogBundleSha256(bundle)) {
      throw new Error("Catalog release ID already exists with different content");
    }
    if (!existing) {
      await this.kv.put(`${RELEASE_PREFIX}${releaseId}`, JSON.stringify(bundle));
    }
    const pointers = (await this.readPointersV2()) ?? freshPointers();
    await this.writePointers({ ...pointers, candidate: releaseId });
  }

  async promoteCandidate(attestation: CatalogReleaseAttestation): Promise<void> {
    assertCatalogReleaseAttestation(attestation);
    const pointers = (await this.readPointersV2()) ?? freshPointers();
    if (pointers.candidate !== attestation.release_id) {
      throw new Error("Catalog candidate release mismatch");
    }
    const candidate = await this.readRelease(attestation.release_id);
    if (!candidate) throw new Error("Catalog candidate release is missing");
    assertPromotedCatalogBundle(candidate, attestation.release_id);
    assertCatalogSafetyContext(candidate.meta.security, attestation);
    if (catalogBundleSha256(candidate) !== attestation.content_sha256) {
      throw new Error("Catalog candidate content digest mismatch");
    }

    // Older Worker versions read only the legacy bundle. Write the already
    // scanned candidate there before switching V2 so an emergency code
    // rollback cannot reactivate a stale, unverified catalog.
    await this.kv.put(BUNDLE_KEY, JSON.stringify(candidate));
    await this.writePointers({
      schema_version: POINTER_SCHEMA_VERSION,
      active: attestation,
      previous:
        pointers.active && catalogSafetyContextsEqual(pointers.active, attestation)
          ? pointers.active
          : undefined,
    });
  }

  async rollback(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointersV2();
    if (!pointers?.active || !pointers.previous) return null;
    await this.readAttestedRelease(pointers.active, safety);
    const previous = await this.readAttestedRelease(pointers.previous, safety);
    if (!previous) return null;
    await this.kv.put(BUNDLE_KEY, JSON.stringify(previous));
    await this.writePointers({
      schema_version: POINTER_SCHEMA_VERSION,
      active: pointers.previous,
      previous: pointers.active,
    });
    return previous;
  }

  async loadLastRefresh(): Promise<unknown | null> {
    return await this.kv.get(LAST_REFRESH_KEY, "json");
  }

  async saveLastRefresh(value: unknown): Promise<void> {
    await this.kv.put(LAST_REFRESH_KEY, JSON.stringify(value));
  }

  async tryAcquireRefreshLock(ttlMs: number): Promise<boolean> {
    const existing = await this.kv.get<{ expires_at: number }>(LOCK_KEY, "json");
    if (existing && existing.expires_at > Date.now()) return false;

    await this.kv.put(LOCK_KEY, JSON.stringify({ expires_at: Date.now() + ttlMs }), {
      expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)),
    });
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    await this.kv.delete(LOCK_KEY);
  }

  private async readPointersV2(): Promise<CatalogPointersV2 | null> {
    const value = await this.kv.get<unknown>(POINTERS_KEY, "json");
    if (!isRecord(value) || value.schema_version !== POINTER_SCHEMA_VERSION) return null;
    const pointers: CatalogPointersV2 = { schema_version: POINTER_SCHEMA_VERSION };
    if (value.active !== undefined) pointers.active = parseAttestation(value.active);
    if (value.previous !== undefined) pointers.previous = parseAttestation(value.previous);
    if (value.candidate !== undefined) {
      if (typeof value.candidate !== "string") throw new Error("Invalid catalog candidate pointer");
      assertReleaseId(value.candidate);
      pointers.candidate = value.candidate;
    }
    return pointers;
  }

  private async writePointers(pointers: CatalogPointersV2): Promise<void> {
    await this.kv.put(POINTERS_KEY, JSON.stringify(pointers));
  }

  private async readRelease(releaseId: string): Promise<CatalogBundle | null> {
    assertReleaseId(releaseId);
    return await this.kv.get<CatalogBundle>(`${RELEASE_PREFIX}${releaseId}`, "json");
  }

  private async readAttestedRelease(
    attestation: CatalogReleaseAttestation,
    safety: CatalogSafetyContext
  ): Promise<CatalogBundle | null> {
    assertCatalogReleaseAttestation(attestation);
    assertCatalogSafetyContext(attestation, safety);
    const bundle = await this.readRelease(attestation.release_id);
    if (!bundle) return null;
    assertPromotedCatalogBundle(bundle, attestation.release_id);
    assertCatalogSafetyContext(bundle.meta.security, safety);
    if (catalogBundleSha256(bundle) !== attestation.content_sha256) {
      throw new Error("Promoted catalog content digest mismatch");
    }
    return bundle;
  }
}

function freshPointers(): CatalogPointersV2 {
  return { schema_version: POINTER_SCHEMA_VERSION };
}

function requiredReleaseId(bundle: CatalogBundle): string {
  const releaseId = bundle.meta.release_id;
  if (!releaseId) throw new Error("Catalog candidate has no release_id");
  assertReleaseId(releaseId);
  return releaseId;
}

function parseAttestation(value: unknown): CatalogReleaseAttestation {
  if (
    !isRecord(value) ||
    typeof value.release_id !== "string" ||
    typeof value.content_sha256 !== "string" ||
    typeof value.registry_revision !== "string" ||
    typeof value.safety_policy_version !== "string"
  ) {
    throw new Error("Invalid catalog release attestation");
  }
  const attestation: CatalogReleaseAttestation = {
    release_id: value.release_id,
    content_sha256: value.content_sha256,
    registry_revision: value.registry_revision,
    safety_policy_version: value.safety_policy_version,
  };
  assertCatalogReleaseAttestation(attestation);
  return attestation;
}

function activeReleaseId(value: Record<string, unknown> | null): string | null {
  const active = value?.active;
  if (typeof active === "string") return active;
  return isRecord(active) && typeof active.release_id === "string" ? active.release_id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
