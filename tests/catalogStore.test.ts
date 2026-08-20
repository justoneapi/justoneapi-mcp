import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { CatalogManager } from "../src/catalog/manager.js";
import { CatalogBundle, CatalogStore } from "../src/catalog/types.js";
import { FileCatalogStore } from "../src/node/fileCatalogStore.js";
import { catalogReleaseAttestation, catalogSafetyContext } from "../src/catalog/release.js";

const tempDirs: string[] = [];
const SAFETY = catalogSafetyContext();
const POINTERS_FILE = "catalog-pointers-v3.json";
const LEGACY_POINTERS_FILE = "catalog-pointers.json";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

function releasedDocument(summary: string, description: string) {
  return {
    "x-openapi-release-id": "release-stable",
    paths: {
      "/api/web/test/v1": {
        get: {
          summary,
          description,
          operationId: "getWebTestV1",
          responses: {},
        },
      },
    },
  };
}

function localizedBundle(
  english: ReturnType<typeof releasedDocument>,
  chinese: ReturnType<typeof releasedDocument>,
  generatedAt: string
): CatalogBundle {
  return buildCatalogBundle({
    openapi: english,
    openapiZh: chinese,
    openapiText: JSON.stringify(english),
    openapiZhText: JSON.stringify(chinese),
    openapiUrl: "https://docs.justoneapi.com/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    generatedAt,
    requireLocalizedReleaseId: true,
  });
}

function managerConfig() {
  return {
    baseUrl: "https://api.justoneapi.com",
    openapiUrl: "https://docs.justoneapi.com/openapi.json",
    openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
    catalogRefreshIntervalMs: 0,
    catalogMemoryTtlMs: 60_000,
    debug: false,
    searchV2Enabled: false,
    timeoutMs: 1_000,
    retry: 0,
  };
}

describe("catalog active/previous release store", () => {
  it("promotes a candidate atomically while retaining a rollback release", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const legacy = bundle("Legacy title", "2026-07-14T00:00:00.000Z");
    delete legacy.meta.release_id;
    const next = bundle("New title", "2026-07-15T00:00:00.000Z");
    const latest = bundle("Latest title", "2026-07-16T00:00:00.000Z");

    await store.save(legacy);
    await store.saveCandidate(next);
    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy title");
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
    expect((await store.loadCandidate())?.meta.release_id).toBe(next.meta.release_id);

    await store.promoteCandidate(catalogReleaseAttestation(next));
    expect((await store.load())?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("New title");
    await expect(store.loadPrevious(SAFETY)).resolves.toBeNull();
    await expect(store.rollback(SAFETY)).resolves.toBeNull();

    await store.saveCandidate(latest);
    await store.promoteCandidate(catalogReleaseAttestation(latest));
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("Latest title");
    expect((await store.loadPrevious(SAFETY))?.catalog.endpoints[0].title_en).toBe("New title");

    const rolledBack = await store.rollback(SAFETY);
    expect(rolledBack?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPrevious(SAFETY))?.catalog.endpoints[0].title_en).toBe("Latest title");
  });

  it("rejects a promoted pointer when the immutable release envelope was changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const next = bundle("New title", "2026-07-15T00:00:00.000Z");

    await store.saveCandidate(next);
    const releaseFile = join(dir, "catalog-releases", `${next.meta.release_id}.json`);
    const changed = structuredClone(next);
    changed.catalog.endpoints[0].description_en = "Changed after the candidate was attested.";
    await writeFile(releaseFile, `${JSON.stringify(changed)}\n`, "utf8");

    await expect(store.promoteCandidate(catalogReleaseAttestation(next))).rejects.toThrow(
      "Catalog candidate content digest mismatch"
    );
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
  });

  it("rejects an active release whose payload changed without changing its release ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const active = bundle("Active title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));

    const changed = structuredClone(active);
    changed.catalog.endpoints[0].description_en = "Changed after promotion.";
    await writeFile(
      join(dir, "catalog-releases", `${active.meta.release_id}.json`),
      `${JSON.stringify(changed)}\n`,
      "utf8"
    );

    await expect(store.loadPromoted(SAFETY)).rejects.toThrow(
      "Promoted catalog content digest mismatch"
    );
    const bundled = bundle("Bundled fallback", "2026-07-14T00:00:00.000Z");
    await expect(new CatalogManager(store, bundled, managerConfig()).load()).resolves.toBe(bundled);
  });

  it("does not overwrite an immutable release with different content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const original = bundle("Original title", "2026-07-15T00:00:00.000Z");
    const changed = structuredClone(original);
    changed.catalog.endpoints[0].description_en = "Different content under the same release ID.";

    await store.saveCandidate(original);
    await expect(store.saveCandidate(changed)).rejects.toThrow(
      "Catalog release ID already exists with different content"
    );
  });

  it("does not switch the active pointer when the legacy mirror cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const legacy = bundle("Legacy title", "2026-07-14T00:00:00.000Z");
    const next = bundle("New title", "2026-07-15T00:00:00.000Z");

    await store.saveCandidate(legacy);
    await store.promoteCandidate(catalogReleaseAttestation(legacy));
    await store.saveCandidate(next);
    const pointersFile = join(dir, POINTERS_FILE);
    const pointersBefore = await readFile(pointersFile, "utf8");
    await rm(join(dir, "catalog-bundle.json"), { force: true });
    await mkdir(join(dir, "catalog-bundle.json"));

    await expect(store.promoteCandidate(catalogReleaseAttestation(next))).rejects.toThrow();
    expect(await readFile(pointersFile, "utf8")).toBe(pointersBefore);
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("Legacy title");
    await expect(store.loadPrevious(SAFETY)).resolves.toBeNull();
  });

  it("does not switch rollback pointers when the legacy mirror cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const previous = bundle("Previous title", "2026-07-14T00:00:00.000Z");
    const active = bundle("Active title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(previous);
    await store.promoteCandidate(catalogReleaseAttestation(previous));
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));
    const pointersFile = join(dir, POINTERS_FILE);
    const pointersBefore = await readFile(pointersFile, "utf8");
    await rm(join(dir, "catalog-bundle.json"), { force: true });
    await mkdir(join(dir, "catalog-bundle.json"));

    await expect(store.rollback(SAFETY)).rejects.toThrow();
    expect(await readFile(pointersFile, "utf8")).toBe(pointersBefore);
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("Active title");
  });

  it("does not switch rollback pointers when the previous release was corrupted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const previous = bundle("Previous title", "2026-07-14T00:00:00.000Z");
    const active = bundle("Active title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(previous);
    await store.promoteCandidate(catalogReleaseAttestation(previous));
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active));
    const pointersFile = join(dir, POINTERS_FILE);
    const pointersBefore = await readFile(pointersFile, "utf8");

    const changed = structuredClone(previous);
    changed.catalog.endpoints[0].description_en = "Corrupted previous release.";
    await writeFile(
      join(dir, "catalog-releases", `${previous.meta.release_id}.json`),
      `${JSON.stringify(changed)}\n`,
      "utf8"
    );

    await expect(store.rollback(SAFETY)).rejects.toThrow(
      "Promoted catalog content digest mismatch"
    );
    expect(await readFile(pointersFile, "utf8")).toBe(pointersBefore);
  });

  it("does not promote a staged candidate whose semantic fingerprint changed", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    let candidate: CatalogBundle | null = null;
    let promoted = false;
    const store: CatalogStore = {
      load: async () => current,
      save: async () => undefined,
      loadActive: async () => current,
      saveCandidate: async (value) => {
        candidate = structuredClone(value);
        candidate.catalog.endpoints[0].description_en = "Candidate was modified after staging.";
      },
      loadCandidate: async () => candidate,
      promoteCandidate: async () => {
        promoted = true;
      },
    };
    const nextOpenapi = {
      "x-openapi-release-id": "release-next",
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Next title",
            description: "Get public web test data.",
            operationId: "getWebTestV1",
            responses: {},
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(nextOpenapi), { status: 200 }))
    );
    const config = {
      baseUrl: "https://api.justoneapi.com",
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60_000,
      debug: false,
      searchV2Enabled: false,
      timeoutMs: 1_000,
      retry: 0,
    };
    const manager = new CatalogManager(store, current, config);

    const result = await manager.refresh();
    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      code: "OPENAPI_FETCH_FAILED",
      message: "Catalog refresh failed.",
    });
    expect(promoted).toBe(false);
  });

  it("keeps the public-safety scan at the candidate promotion boundary", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    let candidate: CatalogBundle | null = null;
    const promoteCandidate = vi.fn(async () => undefined);
    const store: CatalogStore = {
      load: async () => current,
      save: async () => undefined,
      saveCandidate: async (value) => {
        candidate = structuredClone(value);
        Object.assign(candidate.catalog.endpoints[0], { routeRef: "internal-route" });
      },
      loadCandidate: async () => candidate,
      promoteCandidate,
    };
    const nextOpenapi = {
      "x-openapi-release-id": "release-next",
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "Next title",
            description: "Get public web test data.",
            operationId: "getWebTestV1",
            responses: {},
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(nextOpenapi), { status: 200 }))
    );

    await expect(
      new CatalogManager(store, current, managerConfig()).refresh()
    ).resolves.toMatchObject({
      success: false,
      error: {
        code: "CATALOG_UNSAFE",
        message: "Catalog refresh failed public safety validation.",
      },
    });
    expect(promoteCandidate).not.toHaveBeenCalled();
  });

  it("publishes a semantic correction even when both OpenAPI source hashes are unchanged", async () => {
    const english = releasedDocument("Canonical title", "Canonical public meaning.");
    const chinese = releasedDocument("规范标题", "规范的公开含义。");
    const current = localizedBundle(english, chinese, "2000-01-01T00:00:00.000Z");
    current.catalog.endpoints[0].description_en = "Stale generated meaning.";
    let candidate: CatalogBundle | null = null;
    const promoteCandidate = vi.fn(async () => undefined);
    const store: CatalogStore = {
      load: async () => current,
      loadActive: async () => current,
      save: async () => undefined,
      saveCandidate: async (value) => {
        candidate = structuredClone(value);
      },
      loadCandidate: async () => candidate,
      promoteCandidate,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        Response.json(String(input).includes("openapi-zh") ? chinese : english)
      )
    );

    const manager = new CatalogManager(store, current, managerConfig());
    const result = await manager.refresh();

    expect(result).toMatchObject({
      success: true,
      changed: true,
      structure_changed: false,
      localization_changed: false,
      modified: ["web.test_v1"],
    });
    expect(result.release_id).not.toBe(current.meta.release_id);
    expect(promoteCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: result.release_id })
    );
    await expect(manager.load()).resolves.toMatchObject({
      catalog: {
        endpoints: [expect.objectContaining({ description_en: "Canonical public meaning." })],
      },
    });
  });

  it("publishes a generator-version upgrade even when source and endpoint semantics match", async () => {
    const english = releasedDocument("Canonical title", "Canonical public meaning.");
    const chinese = releasedDocument("规范标题", "规范的公开含义。");
    const current = localizedBundle(english, chinese, "2000-01-01T00:00:00.000Z");
    current.meta.generator_version = "1";
    current.meta.release_id = "catalog-legacy-generator";
    let candidate: CatalogBundle | null = null;
    const promoteCandidate = vi.fn(async () => undefined);
    const store: CatalogStore = {
      load: async () => current,
      loadActive: async () => current,
      save: async () => undefined,
      saveCandidate: async (value) => {
        candidate = structuredClone(value);
      },
      loadCandidate: async () => candidate,
      promoteCandidate,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        Response.json(String(input).includes("openapi-zh") ? chinese : english)
      )
    );

    const result = await new CatalogManager(store, current, managerConfig()).refresh();

    expect(result).toMatchObject({
      success: true,
      changed: true,
      structure_changed: false,
      localization_changed: false,
      added: [],
      removed: [],
      modified: [],
    });
    expect(result.release_id).not.toBe(current.meta.release_id);
    expect(promoteCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: result.release_id })
    );
  });

  it.each(["telemetry", "lock"] as const)(
    "does not overwrite a committed promotion when %s cleanup fails",
    async (failure) => {
      const english = releasedDocument("Next title", "Next public meaning.");
      const chinese = releasedDocument("下个标题", "下个公开含义。");
      const current = localizedBundle(
        releasedDocument("Current title", "Current public meaning."),
        releasedDocument("当前标题", "当前公开含义。"),
        "2000-01-01T00:00:00.000Z"
      );
      let candidate: CatalogBundle | null = null;
      let promoted = false;
      const store: CatalogStore = {
        load: async () => current,
        loadActive: async () => current,
        save: async () => undefined,
        saveCandidate: async (value) => {
          candidate = structuredClone(value);
        },
        loadCandidate: async () => candidate,
        promoteCandidate: async () => {
          promoted = true;
        },
        tryAcquireRefreshLock: async () => true,
        releaseRefreshLock: async () => {
          if (failure === "lock") throw new Error("INTERNAL_ERROR_CANARY lock failure");
        },
        saveLastRefresh: async () => {
          if (failure === "telemetry") {
            throw new Error("INTERNAL_ERROR_CANARY telemetry failure");
          }
        },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) =>
          Response.json(String(input).includes("openapi-zh") ? chinese : english)
        )
      );

      const result = await new CatalogManager(store, current, managerConfig()).refresh();

      expect(result).toMatchObject({ success: true, changed: true });
      expect(promoted).toBe(true);
    }
  );

  it("does not reflect malformed remote metadata in public errors", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    const internalCanary = "INTERNAL_METADATA_CANARY";
    const malformed = {
      "x-openapi-release-id": "release-malformed",
      paths: {
        "/api/web/test/v1": {
          get: {
            operationId: "getWebTestV1",
            summary: "Next title",
            "x-highlights": [
              {
                kind: internalCanary,
                content: "Public metadata.",
                concept: "public_metadata",
                aliases: ["public metadata"],
              },
            ],
            responses: {},
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(malformed), { status: 200 }))
    );
    const store: CatalogStore = {
      load: async () => current,
      loadActive: async () => current,
      save: async () => undefined,
    };
    const manager = new CatalogManager(store, current, {
      baseUrl: "https://api.justoneapi.com",
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60_000,
      debug: false,
      searchV2Enabled: false,
      timeoutMs: 1_000,
      retry: 0,
    });

    const result = await manager.refresh();
    expect(result).toMatchObject({
      success: false,
      error: {
        code: "OPENAPI_PARSE_FAILED",
        message: "Catalog refresh could not parse the OpenAPI release.",
      },
    });
    expect(result.error?.message).not.toContain(internalCanary);
  });

  it("uses only the release-scanned bundled catalog when no promoted release exists", async () => {
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const untrusted = bundle("KELE private source", "2026-07-15T00:00:00.000Z");
    const store: CatalogStore = {
      load: async () => untrusted,
      loadActive: async () => untrusted,
      save: async () => undefined,
    };
    const manager = new CatalogManager(store, trusted, managerConfig());

    await expect(manager.load()).resolves.toMatchObject({
      catalog: { endpoints: [expect.objectContaining({ title_en: "Bundled title" })] },
    });
  });

  it("ignores a legacy persisted bundle without a promoted pointer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const legacy = bundle("Legacy title", "2026-07-15T00:00:00.000Z");
    legacy.catalog.endpoints[0].title = "UNATTESTED_CATALOG_CANARY legacy title";
    legacy.catalog.endpoints[0].title_en = "UNATTESTED_CATALOG_CANARY legacy title";
    await store.save(legacy);

    await expect(new CatalogManager(store, trusted, managerConfig()).load()).resolves.toMatchObject(
      {
        catalog: { endpoints: [expect.objectContaining({ title_en: "Bundled title" })] },
      }
    );
    await expect(store.loadActive()).resolves.toMatchObject({
      catalog: {
        endpoints: [
          expect.objectContaining({ title_en: "UNATTESTED_CATALOG_CANARY legacy title" }),
        ],
      },
    });
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
  });

  it("ignores obsolete V2 pointers and falls back to the bundled catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const legacyActive = bundle("Legacy active title", "2026-07-15T00:00:00.000Z");
    await mkdir(join(dir, "catalog-releases"), { recursive: true });
    await writeFile(
      join(dir, "catalog-releases", `${legacyActive.meta.release_id}.json`),
      `${JSON.stringify(legacyActive)}\n`,
      "utf8"
    );
    await writeFile(
      join(dir, LEGACY_POINTERS_FILE),
      `${JSON.stringify({
        schema_version: 2,
        active: { release_id: legacyActive.meta.release_id },
      })}\n`,
      "utf8"
    );

    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy active title");
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
    await expect(new CatalogManager(store, trusted, managerConfig()).load()).resolves.toBe(trusted);

    const legacyPointersBefore = await readFile(join(dir, LEGACY_POINTERS_FILE), "utf8");
    await store.saveCandidate(trusted);
    await store.promoteCandidate(catalogReleaseAttestation(trusted));
    expect(await readFile(join(dir, LEGACY_POINTERS_FILE), "utf8")).toBe(legacyPointersBefore);
    expect((await store.loadPromoted(SAFETY))?.meta.release_id).toBe(trusted.meta.release_id);
  });

  it("loads only the promoted release without consulting legacy store methods", async () => {
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const promoted = bundle("Promoted title", "2026-07-15T00:00:00.000Z");
    const load = vi.fn(async () => {
      throw new Error("legacy load must not run");
    });
    const loadActive = vi.fn(async () => {
      throw new Error("legacy-compatible active load must not run");
    });
    const loadPromoted = vi.fn(async () => promoted);
    const store: CatalogStore = {
      load,
      loadActive,
      loadPromoted,
      save: async () => undefined,
    };

    await expect(new CatalogManager(store, trusted, managerConfig()).load()).resolves.toMatchObject(
      {
        catalog: { endpoints: [expect.objectContaining({ title_en: "Promoted title" })] },
      }
    );
    expect(loadPromoted).toHaveBeenCalledOnce();
    expect(loadActive).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("does not recursively rescan an attested catalog during ordinary load", async () => {
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const promoted = bundle("Promoted title", "2026-07-15T00:00:00.000Z");
    let traversed = false;
    promoted.catalog.endpoints[0] = new Proxy(promoted.catalog.endpoints[0], {
      ownKeys() {
        traversed = true;
        throw new Error("ordinary load recursively traversed the catalog");
      },
    });
    const store: CatalogStore = {
      load: async () => null,
      loadPromoted: async () => promoted,
      save: async () => undefined,
    };

    await expect(new CatalogManager(store, trusted, managerConfig()).load(true)).resolves.toBe(
      promoted
    );
    expect(traversed).toBe(false);
  });

  it("keeps the localized active release when the Chinese OpenAPI fetch fails", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    current.catalog.endpoints[0].title = "当前标题";
    current.meta.localization_available = true;
    current.meta.source.openapi_zh_sha256 = "existing-localization-hash";
    const save = vi.fn(async () => undefined);
    const saveCandidate = vi.fn(async () => undefined);
    const promoteCandidate = vi.fn(async () => undefined);
    const store: CatalogStore = {
      load: async () => current,
      loadActive: async () => current,
      save,
      saveCandidate,
      loadCandidate: async () => null,
      promoteCandidate,
    };
    const english = {
      paths: {
        "/api/web/test/v1": {
          get: { summary: "Next title", operationId: "getWebTestV1", responses: {} },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("openapi-zh")
          ? new Response("", { status: 503 })
          : new Response(JSON.stringify(english), { status: 200 })
      )
    );
    const manager = new CatalogManager(store, current, {
      baseUrl: "https://api.justoneapi.com",
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60_000,
      debug: false,
      searchV2Enabled: false,
      timeoutMs: 1_000,
      retry: 0,
    });

    await expect(manager.refresh()).resolves.toMatchObject({
      success: false,
      changed: false,
      error: { code: "OPENAPI_FETCH_FAILED" },
    });
    await expect(manager.load()).resolves.toMatchObject({
      meta: { localization_available: true },
      catalog: { endpoints: [expect.objectContaining({ title: "当前标题" })] },
    });
    expect(save).not.toHaveBeenCalled();
    expect(saveCandidate).not.toHaveBeenCalled();
    expect(promoteCandidate).not.toHaveBeenCalled();
  });
});
