import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CatalogBundle, CatalogStore } from "../catalog/types.js";

const BUNDLE_FILE = "catalog-bundle.json";
const LAST_REFRESH_FILE = "catalog-last-refresh.json";
const LOCK_FILE = "catalog-refresh-lock.json";
const POINTERS_FILE = "catalog-pointers.json";
const RELEASES_DIR = "catalog-releases";

type CatalogPointers = {
  active?: string;
  previous?: string;
  candidate?: string;
};

export class FileCatalogStore implements CatalogStore {
  constructor(private readonly dir: string = defaultCacheDir()) {}

  async load(): Promise<CatalogBundle | null> {
    return await this.loadActive();
  }

  async save(bundle: CatalogBundle): Promise<void> {
    await this.writeJson(BUNDLE_FILE, bundle);
  }

  async loadActive(): Promise<CatalogBundle | null> {
    const pointers = await this.readJson<CatalogPointers>(POINTERS_FILE);
    return pointers?.active
      ? await this.readRelease(pointers.active)
      : await this.readJson<CatalogBundle>(BUNDLE_FILE);
  }

  async loadPrevious(): Promise<CatalogBundle | null> {
    const pointers = await this.readJson<CatalogPointers>(POINTERS_FILE);
    return pointers?.previous ? await this.readRelease(pointers.previous) : null;
  }

  async loadCandidate(): Promise<CatalogBundle | null> {
    const pointers = await this.readJson<CatalogPointers>(POINTERS_FILE);
    return pointers?.candidate ? await this.readRelease(pointers.candidate) : null;
  }

  async saveCandidate(bundle: CatalogBundle): Promise<void> {
    const releaseId = requiredReleaseId(bundle);
    await this.writeRelease(releaseId, bundle);
    const pointers = (await this.readJson<CatalogPointers>(POINTERS_FILE)) ?? {};
    await this.writeJson(POINTERS_FILE, { ...pointers, candidate: releaseId });
  }

  async promoteCandidate(releaseId: string): Promise<void> {
    assertReleaseId(releaseId);
    const pointers = (await this.readJson<CatalogPointers>(POINTERS_FILE)) ?? {};
    if (pointers.candidate !== releaseId) throw new Error("Catalog candidate release mismatch");
    const candidate = await this.readRelease(releaseId);
    if (!candidate) throw new Error("Catalog candidate release is missing");

    const current = await this.loadActive();
    let previous = pointers.active;
    if (current && !previous) {
      const legacy = withReleaseId(current);
      previous = requiredReleaseId(legacy);
      await this.writeRelease(previous, legacy);
    }

    await this.writeJson(POINTERS_FILE, {
      active: releaseId,
      previous,
    });
    // The pointer is the authoritative atomic switch. Keep the legacy bundle
    // in sync only after active/previous can already be resolved by release ID.
    // A compatibility-mirror failure must not misreport the committed switch.
    try {
      await this.writeJson(BUNDLE_FILE, candidate);
    } catch {
      // Active/previous remain readable through their immutable release files.
    }
  }

  async rollback(): Promise<CatalogBundle | null> {
    const pointers = await this.readJson<CatalogPointers>(POINTERS_FILE);
    if (!pointers?.active || !pointers.previous) return null;
    const previous = await this.readRelease(pointers.previous);
    if (!previous) return null;
    await this.writeJson(POINTERS_FILE, {
      active: pointers.previous,
      previous: pointers.active,
    });
    try {
      await this.writeJson(BUNDLE_FILE, previous);
    } catch {
      // The authoritative rollback pointer has already committed.
    }
    return previous;
  }

  async loadLastRefresh(): Promise<unknown | null> {
    return await this.readJson<unknown>(LAST_REFRESH_FILE);
  }

  async saveLastRefresh(value: unknown): Promise<void> {
    await this.writeJson(LAST_REFRESH_FILE, value);
  }

  async tryAcquireRefreshLock(ttlMs: number): Promise<boolean> {
    const existing = await this.readJson<{ expires_at: number }>(LOCK_FILE);
    if (existing && existing.expires_at > Date.now()) return false;
    await this.writeJson(LOCK_FILE, { expires_at: Date.now() + ttlMs });
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    await rm(join(this.dir, LOCK_FILE), { force: true });
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      const text = await readFile(join(this.dir, file), "utf8");
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const target = join(this.dir, file);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  private async readRelease(releaseId: string): Promise<CatalogBundle | null> {
    assertReleaseId(releaseId);
    return await this.readJson<CatalogBundle>(join(RELEASES_DIR, `${releaseId}.json`));
  }

  private async writeRelease(releaseId: string, bundle: CatalogBundle): Promise<void> {
    assertReleaseId(releaseId);
    await this.writeJson(join(RELEASES_DIR, `${releaseId}.json`), bundle);
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

function defaultCacheDir(): string {
  if (process.env.JUSTONEAPI_CATALOG_CACHE_DIR) {
    return process.env.JUSTONEAPI_CATALOG_CACHE_DIR;
  }
  return join(homedir(), ".cache", "justoneapi-mcp");
}
