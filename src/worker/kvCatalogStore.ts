import { CatalogBundle, CatalogStore } from "../catalog/types.js";

const BUNDLE_KEY = "catalog:bundle";
const LAST_REFRESH_KEY = "catalog:last-refresh";
const LOCK_KEY = "catalog:refresh-lock";
const POINTERS_KEY = "catalog:pointers";
const RELEASE_PREFIX = "catalog:release:";

type CatalogPointers = {
  active?: string;
  previous?: string;
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

  async loadActive(): Promise<CatalogBundle | null> {
    const pointers = await this.kv.get<CatalogPointers>(POINTERS_KEY, "json");
    return pointers?.active
      ? await this.readRelease(pointers.active)
      : await this.kv.get<CatalogBundle>(BUNDLE_KEY, "json");
  }

  async loadPrevious(): Promise<CatalogBundle | null> {
    const pointers = await this.kv.get<CatalogPointers>(POINTERS_KEY, "json");
    return pointers?.previous ? await this.readRelease(pointers.previous) : null;
  }

  async loadCandidate(): Promise<CatalogBundle | null> {
    const pointers = await this.kv.get<CatalogPointers>(POINTERS_KEY, "json");
    return pointers?.candidate ? await this.readRelease(pointers.candidate) : null;
  }

  async saveCandidate(bundle: CatalogBundle): Promise<void> {
    const releaseId = requiredReleaseId(bundle);
    await this.kv.put(`${RELEASE_PREFIX}${releaseId}`, JSON.stringify(bundle));
    const pointers = (await this.kv.get<CatalogPointers>(POINTERS_KEY, "json")) ?? {};
    await this.kv.put(POINTERS_KEY, JSON.stringify({ ...pointers, candidate: releaseId }));
  }

  async promoteCandidate(releaseId: string): Promise<void> {
    assertReleaseId(releaseId);
    const pointers = (await this.kv.get<CatalogPointers>(POINTERS_KEY, "json")) ?? {};
    if (pointers.candidate !== releaseId) throw new Error("Catalog candidate release mismatch");
    const candidate = await this.readRelease(releaseId);
    if (!candidate) throw new Error("Catalog candidate release is missing");

    const current = await this.loadActive();
    let previous = pointers.active;
    if (current && !previous) {
      const legacy = withReleaseId(current);
      previous = requiredReleaseId(legacy);
      await this.kv.put(`${RELEASE_PREFIX}${previous}`, JSON.stringify(legacy));
    }

    await this.kv.put(
      POINTERS_KEY,
      JSON.stringify({ active: releaseId, previous } satisfies CatalogPointers)
    );
    // The pointer is the authoritative switch; the legacy bundle is only a
    // compatibility mirror for older deployments. A mirror failure must not
    // turn an already-committed promotion into a reported failure.
    try {
      await this.kv.put(BUNDLE_KEY, JSON.stringify(candidate));
    } catch {
      // Active/previous remain readable through their immutable release IDs.
    }
  }

  async rollback(): Promise<CatalogBundle | null> {
    const pointers = await this.kv.get<CatalogPointers>(POINTERS_KEY, "json");
    if (!pointers?.active || !pointers.previous) return null;
    const previous = await this.readRelease(pointers.previous);
    if (!previous) return null;
    await this.kv.put(
      POINTERS_KEY,
      JSON.stringify({
        active: pointers.previous,
        previous: pointers.active,
      } satisfies CatalogPointers)
    );
    try {
      await this.kv.put(BUNDLE_KEY, JSON.stringify(previous));
    } catch {
      // The authoritative rollback pointer has already committed.
    }
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

  private async readRelease(releaseId: string): Promise<CatalogBundle | null> {
    assertReleaseId(releaseId);
    return await this.kv.get<CatalogBundle>(`${RELEASE_PREFIX}${releaseId}`, "json");
  }
}

function requiredReleaseId(bundle: CatalogBundle): string {
  const releaseId = bundle.meta.release_id;
  if (!releaseId) throw new Error("Catalog candidate has no release_id");
  assertReleaseId(releaseId);
  return releaseId;
}

function withReleaseId(bundle: CatalogBundle): CatalogBundle {
  if (bundle.meta.release_id) return bundle;
  const timestamp = bundle.meta.generated_at.replace(/[^0-9]/g, "").slice(0, 14);
  return {
    ...bundle,
    meta: {
      ...bundle.meta,
      release_id: `legacy-${timestamp}-${bundle.meta.source.openapi_sha256.slice(0, 12)}`,
    },
  };
}

function assertReleaseId(releaseId: string): void {
  if (!/^[a-z0-9._-]+$/i.test(releaseId)) throw new Error("Invalid catalog release_id");
}
