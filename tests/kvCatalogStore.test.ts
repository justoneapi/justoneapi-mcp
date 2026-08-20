import { describe, expect, it } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { catalogReleaseAttestation, catalogSafetyContext } from "../src/catalog/release.js";
import { CatalogBundle } from "../src/catalog/types.js";
import { KvCatalogStore } from "../src/worker/kvCatalogStore.js";

const BUNDLE_KEY = "catalog:bundle";
const POINTERS_KEY = "catalog:pointers:v3";
const LEGACY_POINTERS_KEY = "catalog:pointers";
const RELEASE_PREFIX = "catalog:release:";
const SAFETY = catalogSafetyContext();

class MemoryKv {
  private readonly values = new Map<string, string>();
  private failedPutKey: string | null = null;

  readonly namespace = {
    get: async (key: string, type?: string) => {
      const value = this.values.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: unknown) => {
      if (key === this.failedPutKey) throw new Error("simulated KV put failure");
      if (typeof value !== "string") {
        throw new Error("Memory KV accepts string values only");
      }
      this.values.set(key, value);
    },
    delete: async (key: string) => {
      this.values.delete(key);
    },
  } as unknown as KVNamespace;

  putJson(key: string, value: unknown): void {
    this.values.set(key, JSON.stringify(value));
  }

  getJson<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  failPutsFor(key: string | null): void {
    this.failedPutKey = key;
  }
}

function bundle(summary: string, generatedAt: string): CatalogBundle {
  const openapi = {
    paths: {
      "/api/web/test/v1": {
        get: {
          summary,
          description: "Get public web test data.",
          operationId: "getWebTestV1",
          responses: {},
        },
      },
    },
  };
  return buildCatalogBundle({
    openapi,
    openapiText: JSON.stringify(openapi),
    openapiUrl: "https://docs.justoneapi.com/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    generatedAt,
  });
}

describe("KV catalog V3 release attestations", () => {
  it("keeps obsolete pointers isolated while promoting a V3 release", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const legacy = bundle("Legacy title", "2026-07-14T00:00:00.000Z");

    memory.putJson(BUNDLE_KEY, legacy);
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();

    memory.putJson(`${RELEASE_PREFIX}${legacy.meta.release_id}`, legacy);
    const legacyPointers = {
      schema_version: 2,
      active: { release_id: legacy.meta.release_id },
    };
    memory.putJson(LEGACY_POINTERS_KEY, legacyPointers);
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();

    await store.saveCandidate(legacy);
    await store.promoteCandidate(catalogReleaseAttestation(legacy));
    expect(memory.getJson(LEGACY_POINTERS_KEY)).toEqual(legacyPointers);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(legacy.meta.release_id);

    memory.putJson(LEGACY_POINTERS_KEY, {
      schema_version: 2,
      active: { release_id: "catalog-written-by-old-isolate" },
    });
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(legacy.meta.release_id);
  });

  it("promotes two attested releases and rolls back to the previous release", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const first = bundle("First title", "2026-07-14T00:00:00.000Z");
    const second = bundle("Second title", "2026-07-15T00:00:00.000Z");

    await store.saveCandidate(first);
    await store.promoteCandidate(catalogReleaseAttestation(first));
    await expect(store.loadPrevious(SAFETY)).resolves.toBeNull();

    await store.saveCandidate(second);
    await store.promoteCandidate(catalogReleaseAttestation(second));
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(second.meta.release_id);
    expect((await store.loadPrevious(SAFETY))?.meta.release_id).toBe(first.meta.release_id);
    expect(
      memory.getJson<{ schema_version: number; active: Record<string, unknown> }>(POINTERS_KEY)
    ).toMatchObject({ schema_version: 3 });
    expect(
      Object.keys(
        memory.getJson<{ active: Record<string, unknown> }>(POINTERS_KEY)?.active ?? {}
      ).sort()
    ).toEqual(["content_sha256", "release_id", "safety_policy_version"]);

    const rolledBack = await store.rollback(SAFETY);
    expect(rolledBack?.meta.release_id).toBe(first.meta.release_id);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(first.meta.release_id);
    expect((await store.loadPrevious(SAFETY))?.meta.release_id).toBe(second.meta.release_id);
  });

  it("rejects a promoted release from a different safety policy", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const active = bundle("Active title", "2026-07-14T00:00:00.000Z");
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));

    await expect(store.loadPromoted({ safety_policy_version: "obsolete-policy" })).rejects.toThrow(
      "Catalog safety policy revision mismatch"
    );
  });

  it("rejects active payload tampering even when release ID and endpoint count are unchanged", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const active = bundle("Active title", "2026-07-14T00:00:00.000Z");

    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));

    const changed = structuredClone(active);
    changed.catalog.endpoints[0].description_en = "Changed after promotion.";
    expect(changed.meta.release_id).toBe(active.meta.release_id);
    expect(changed.meta.endpoint_count).toBe(active.meta.endpoint_count);
    memory.putJson(`${RELEASE_PREFIX}${active.meta.release_id}`, changed);

    await expect(store.loadPromoted(SAFETY)).rejects.toThrow(
      "Promoted catalog content digest mismatch"
    );
  });

  it("rejects a damaged previous release without changing the rollback pointer", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const first = bundle("First title", "2026-07-14T00:00:00.000Z");
    const second = bundle("Second title", "2026-07-15T00:00:00.000Z");

    await store.saveCandidate(first);
    await store.promoteCandidate(catalogReleaseAttestation(first));
    await store.saveCandidate(second);
    await store.promoteCandidate(catalogReleaseAttestation(second));
    const pointersBefore = memory.getJson<unknown>(POINTERS_KEY);

    const damagedPrevious = structuredClone(first);
    damagedPrevious.catalog.endpoints[0].description_en = "Damaged after promotion.";
    memory.putJson(`${RELEASE_PREFIX}${first.meta.release_id}`, damagedPrevious);

    await expect(store.rollback(SAFETY)).rejects.toThrow(
      "Promoted catalog content digest mismatch"
    );
    expect(memory.getJson<unknown>(POINTERS_KEY)).toEqual(pointersBefore);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(second.meta.release_id);
  });

  it("does not overwrite an existing release with different content under the same ID", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const active = bundle("Active title", "2026-07-14T00:00:00.000Z");

    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));

    const conflicting = structuredClone(active);
    conflicting.catalog.endpoints[0].description_en = "Conflicting content.";
    await expect(store.saveCandidate(conflicting)).rejects.toThrow(
      "Catalog release ID already exists with different content"
    );

    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].description_en).toBe(
      active.catalog.endpoints[0].description_en
    );
  });

  it("does not promote when the legacy rollback mirror cannot be written", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const first = bundle("First title", "2026-07-14T00:00:00.000Z");
    const second = bundle("Second title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(first);
    await store.promoteCandidate(catalogReleaseAttestation(first));
    await store.saveCandidate(second);
    const pointersBefore = memory.getJson<unknown>(POINTERS_KEY);
    memory.failPutsFor(BUNDLE_KEY);

    await expect(store.promoteCandidate(catalogReleaseAttestation(second))).rejects.toThrow(
      "simulated KV put failure"
    );
    expect(memory.getJson<unknown>(POINTERS_KEY)).toEqual(pointersBefore);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(first.meta.release_id);
  });

  it("does not roll back when the legacy rollback mirror cannot be written", async () => {
    const memory = new MemoryKv();
    const store = new KvCatalogStore(memory.namespace);
    const first = bundle("First title", "2026-07-14T00:00:00.000Z");
    const second = bundle("Second title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(first);
    await store.promoteCandidate(catalogReleaseAttestation(first));
    await store.saveCandidate(second);
    await store.promoteCandidate(catalogReleaseAttestation(second));
    const pointersBefore = memory.getJson<unknown>(POINTERS_KEY);
    memory.failPutsFor(BUNDLE_KEY);

    await expect(store.rollback(SAFETY)).rejects.toThrow("simulated KV put failure");
    expect(memory.getJson<unknown>(POINTERS_KEY)).toEqual(pointersBefore);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(second.meta.release_id);
  });
});
