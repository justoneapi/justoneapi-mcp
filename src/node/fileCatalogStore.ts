import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
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

const BUNDLE_FILE = "catalog-bundle.json";
const LAST_REFRESH_FILE = "catalog-last-refresh.json";
const LOCK_FILE = "catalog-refresh-lock.json";
const POINTERS_FILE = "catalog-pointers-v3.json";
const LEGACY_POINTERS_FILE = "catalog-pointers.json";
const RELEASES_DIR = "catalog-releases";
const POINTER_SCHEMA_VERSION = 3;

type CatalogPointersV3 = {
  schema_version: typeof POINTER_SCHEMA_VERSION;
  active?: CatalogReleaseAttestation;
  previous?: CatalogReleaseAttestation;
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

  async loadPromoted(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointers();
    return pointers?.active ? await this.readAttestedRelease(pointers.active, safety) : null;
  }

  async loadActive(): Promise<CatalogBundle | null> {
    const raw = await this.readJson<Record<string, unknown>>(POINTERS_FILE);
    const legacyRaw = raw
      ? null
      : await this.readJson<Record<string, unknown>>(LEGACY_POINTERS_FILE);
    const releaseId = activeReleaseId(raw) ?? activeReleaseId(legacyRaw);
    return releaseId
      ? await this.readRelease(releaseId)
      : await this.readJson<CatalogBundle>(BUNDLE_FILE);
  }

  async loadPrevious(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointers();
    return pointers?.previous ? await this.readAttestedRelease(pointers.previous, safety) : null;
  }

  async loadCandidate(): Promise<CatalogBundle | null> {
    const pointers = await this.readPointers();
    return pointers?.candidate ? await this.readRelease(pointers.candidate) : null;
  }

  async saveCandidate(bundle: CatalogBundle): Promise<void> {
    const releaseId = requiredReleaseId(bundle);
    const existing = await this.readRelease(releaseId);
    if (existing && catalogBundleSha256(existing) !== catalogBundleSha256(bundle)) {
      throw new Error("Catalog release ID already exists with different content");
    }
    if (!existing) await this.writeRelease(releaseId, bundle);
    const pointers = (await this.readPointers()) ?? freshPointers();
    await this.writeJson(POINTERS_FILE, { ...pointers, candidate: releaseId });
  }

  async promoteCandidate(attestation: CatalogReleaseAttestation): Promise<void> {
    assertCatalogReleaseAttestation(attestation);
    const pointers = (await this.readPointers()) ?? freshPointers();
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

    // Older processes read only the legacy bundle. Write the already scanned
    // candidate there before switching the V3 pointer so a code rollback cannot reactivate
    // a stale, unverified catalog.
    await this.writeJson(BUNDLE_FILE, candidate);
    await this.writeJson(POINTERS_FILE, {
      schema_version: POINTER_SCHEMA_VERSION,
      active: attestation,
      previous:
        pointers.active && catalogSafetyContextsEqual(pointers.active, attestation)
          ? pointers.active
          : undefined,
    });
  }

  async rollback(safety: CatalogSafetyContext): Promise<CatalogBundle | null> {
    const pointers = await this.readPointers();
    if (!pointers?.active || !pointers.previous) return null;
    await this.readAttestedRelease(pointers.active, safety);
    const previous = await this.readAttestedRelease(pointers.previous, safety);
    if (!previous) return null;
    await this.writeJson(BUNDLE_FILE, previous);
    await this.writeJson(POINTERS_FILE, {
      schema_version: POINTER_SCHEMA_VERSION,
      active: pointers.previous,
      previous: pointers.active,
    });
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

  private async readPointers(): Promise<CatalogPointersV3 | null> {
    const value = await this.readJson<unknown>(POINTERS_FILE);
    if (!isRecord(value) || value.schema_version !== POINTER_SCHEMA_VERSION) return null;
    const pointers: CatalogPointersV3 = { schema_version: POINTER_SCHEMA_VERSION };
    if (value.active !== undefined) pointers.active = parseAttestation(value.active);
    if (value.previous !== undefined) pointers.previous = parseAttestation(value.previous);
    if (value.candidate !== undefined) {
      if (typeof value.candidate !== "string") throw new Error("Invalid catalog candidate pointer");
      assertReleaseId(value.candidate);
      pointers.candidate = value.candidate;
    }
    return pointers;
  }

  private async readRelease(releaseId: string): Promise<CatalogBundle | null> {
    assertReleaseId(releaseId);
    try {
      const text = await readFile(join(this.dir, RELEASES_DIR, `${releaseId}.json`), "utf8");
      return JSON.parse(text) as CatalogBundle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
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

  private async writeRelease(releaseId: string, bundle: CatalogBundle): Promise<void> {
    assertReleaseId(releaseId);
    await this.writeJson(join(RELEASES_DIR, `${releaseId}.json`), bundle);
  }
}

function freshPointers(): CatalogPointersV3 {
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
    typeof value.safety_policy_version !== "string"
  ) {
    throw new Error("Invalid catalog release attestation");
  }
  const attestation: CatalogReleaseAttestation = {
    release_id: value.release_id,
    content_sha256: value.content_sha256,
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

function defaultCacheDir(): string {
  if (process.env.JUSTONEAPI_CATALOG_CACHE_DIR) {
    return process.env.JUSTONEAPI_CATALOG_CACHE_DIR;
  }
  return join(homedir(), ".cache", "justoneapi-mcp");
}
