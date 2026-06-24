import { CatalogBundle, CatalogStore } from "../catalog/types.js";

const BUNDLE_KEY = "catalog:bundle";
const LAST_REFRESH_KEY = "catalog:last-refresh";
const LOCK_KEY = "catalog:refresh-lock";

export class KvCatalogStore implements CatalogStore {
  constructor(private readonly kv: KVNamespace) {}

  async load(): Promise<CatalogBundle | null> {
    return await this.kv.get<CatalogBundle>(BUNDLE_KEY, "json");
  }

  async save(bundle: CatalogBundle): Promise<void> {
    await this.kv.put(BUNDLE_KEY, JSON.stringify(bundle));
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
}
