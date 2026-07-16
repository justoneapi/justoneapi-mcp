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
const PRIVATE_TERMS = ["private-registry-canary"];
const SAFETY = catalogSafetyContext(PRIVATE_TERMS);

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function bundle(summary: string, generatedAt: string): CatalogBundle {
  return bundleWithTerms(summary, generatedAt, PRIVATE_TERMS);
}

function bundleWithTerms(
  summary: string,
  generatedAt: string,
  privateTerms: string[]
): CatalogBundle {
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
    forbiddenTerms: privateTerms,
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
    forbiddenTerms: PRIVATE_TERMS,
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
    privateCatalogTerms: PRIVATE_TERMS,
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

    await store.promoteCandidate(catalogReleaseAttestation(next, PRIVATE_TERMS));
    expect((await store.load())?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPromoted(SAFETY))?.catalog.endpoints[0].title_en).toBe("New title");
    await expect(store.loadPrevious(SAFETY)).resolves.toBeNull();
    await expect(store.rollback(SAFETY)).resolves.toBeNull();

    await store.saveCandidate(latest);
    await store.promoteCandidate(catalogReleaseAttestation(latest, PRIVATE_TERMS));
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

    await expect(
      store.promoteCandidate(catalogReleaseAttestation(next, PRIVATE_TERMS))
    ).rejects.toThrow("Catalog candidate content digest mismatch");
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
  });

  it("rejects an active release whose payload changed without changing its release ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const active = bundle("Active title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active, PRIVATE_TERMS));

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
    await store.promoteCandidate(catalogReleaseAttestation(legacy, PRIVATE_TERMS));
    await store.saveCandidate(next);
    const pointersFile = join(dir, "catalog-pointers.json");
    const pointersBefore = await readFile(pointersFile, "utf8");
    await rm(join(dir, "catalog-bundle.json"), { force: true });
    await mkdir(join(dir, "catalog-bundle.json"));

    await expect(
      store.promoteCandidate(catalogReleaseAttestation(next, PRIVATE_TERMS))
    ).rejects.toThrow();
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
    await store.promoteCandidate(catalogReleaseAttestation(previous, PRIVATE_TERMS));
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active, PRIVATE_TERMS));
    const pointersFile = join(dir, "catalog-pointers.json");
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
    await store.promoteCandidate(catalogReleaseAttestation(previous, PRIVATE_TERMS));
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active, PRIVATE_TERMS));
    const pointersFile = join(dir, "catalog-pointers.json");
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
      privateCatalogTerms: ["private-registry-canary"],
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

  it("keeps the confidential registry scan at the candidate promotion boundary", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    let candidate: CatalogBundle | null = null;
    const promoteCandidate = vi.fn(async () => undefined);
    const store: CatalogStore = {
      load: async () => current,
      save: async () => undefined,
      saveCandidate: async (value) => {
        candidate = structuredClone(value);
        candidate.meta.generated_at = "private-registry-canary";
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
          if (failure === "lock") throw new Error("PRIVATE_REGISTRY_CANARY lock failure");
        },
        saveLastRefresh: async () => {
          if (failure === "telemetry") {
            throw new Error("PRIVATE_REGISTRY_CANARY telemetry failure");
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

  it("does not reflect private terms from malformed remote metadata", async () => {
    const current = bundle("Current title", "2026-07-14T00:00:00.000Z");
    const privateTerm = "private-registry-canary";
    const malformed = {
      "x-openapi-release-id": "release-malformed",
      paths: {
        "/api/web/test/v1": {
          get: {
            operationId: "getWebTestV1",
            summary: "Next title",
            "x-highlights": [
              {
                kind: privateTerm,
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
      privateCatalogTerms: [privateTerm],
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
    expect(result.error?.message).not.toContain(privateTerm);
  });

  it("uses only the release-scanned bundled catalog when the private registry is absent", async () => {
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const untrusted = bundle("KELE private source", "2026-07-15T00:00:00.000Z");
    const store: CatalogStore = {
      load: async () => untrusted,
      loadActive: async () => untrusted,
      save: async () => undefined,
    };
    const manager = new CatalogManager(store, trusted, {
      baseUrl: "https://api.justoneapi.com",
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60_000,
      debug: false,
      searchV2Enabled: false,
      privateCatalogTerms: [],
      timeoutMs: 1_000,
      retry: 0,
    });

    await expect(manager.load()).resolves.toMatchObject({
      catalog: { endpoints: [expect.objectContaining({ title_en: "Bundled title" })] },
    });
  });

  it("ignores a legacy persisted bundle even when the private registry is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const legacy = bundle("Legacy title", "2026-07-15T00:00:00.000Z");
    legacy.catalog.endpoints[0].title = "PRIVATE_REGISTRY_CANARY legacy title";
    legacy.catalog.endpoints[0].title_en = "PRIVATE_REGISTRY_CANARY legacy title";
    await store.save(legacy);

    await expect(new CatalogManager(store, trusted, managerConfig()).load()).resolves.toMatchObject(
      {
        catalog: { endpoints: [expect.objectContaining({ title_en: "Bundled title" })] },
      }
    );
    await expect(store.loadActive()).resolves.toMatchObject({
      catalog: {
        endpoints: [expect.objectContaining({ title_en: "PRIVATE_REGISTRY_CANARY legacy title" })],
      },
    });
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
  });

  it("ignores an unversioned active pointer created by a legacy deployment", async () => {
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
      join(dir, "catalog-pointers.json"),
      `${JSON.stringify({ active: legacyActive.meta.release_id })}\n`,
      "utf8"
    );

    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy active title");
    await expect(store.loadPromoted(SAFETY)).resolves.toBeNull();
    await expect(new CatalogManager(store, trusted, managerConfig()).load()).resolves.toBe(trusted);
  });

  it("fails closed when the runtime private registry revision changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const active = bundle("Active title", "2026-07-15T00:00:00.000Z");
    await store.saveCandidate(active);
    await store.promoteCandidate(catalogReleaseAttestation(active, PRIVATE_TERMS));

    const changedTerms = ["different-private-registry"];
    await expect(store.loadPromoted(catalogSafetyContext(changedTerms))).rejects.toThrow(
      "Catalog security registry or safety policy revision mismatch"
    );
    await expect(
      new CatalogManager(store, active, {
        ...managerConfig(),
        privateCatalogTerms: changedTerms,
      }).load()
    ).rejects.toThrow("Catalog security registry or safety policy revision mismatch");
  });

  it("migrates from an old registry attestation through the matching bundled release", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const oldTerms = PRIVATE_TERMS;
    const newTerms = ["new-private-registry"];
    const oldActive = bundleWithTerms("Old active title", "2026-07-14T00:00:00.000Z", oldTerms);
    const newBundled = bundleWithTerms("New bundled title", "2026-07-15T00:00:00.000Z", newTerms);
    await store.saveCandidate(oldActive);
    await store.promoteCandidate(catalogReleaseAttestation(oldActive, oldTerms));
    const openapi = {
      "x-openapi-release-id": "release-new-registry",
      paths: {
        "/api/web/test/v1": {
          get: {
            summary: "New bundled title",
            description: "Get public web test data.",
            operationId: "getWebTestV1",
            responses: {},
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(openapi))
    );
    const manager = new CatalogManager(store, newBundled, {
      ...managerConfig(),
      privateCatalogTerms: newTerms,
    });

    await expect(manager.load()).resolves.toBe(newBundled);
    await expect(manager.refresh()).resolves.toMatchObject({ success: true, changed: true });
    await expect(store.loadPromoted(catalogSafetyContext(newTerms))).resolves.toMatchObject({
      catalog: { endpoints: [expect.objectContaining({ title_en: "New bundled title" })] },
    });
    await expect(store.loadPrevious(catalogSafetyContext(newTerms))).resolves.toBeNull();
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
      privateCatalogTerms: ["private-registry-canary"],
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

  it("does not fetch, stage, promote, or roll back catalogs without the private registry", async () => {
    const trusted = bundle("Bundled title", "2026-07-14T00:00:00.000Z");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const save = vi.fn(async () => undefined);
    const saveCandidate = vi.fn(async () => undefined);
    const promoteCandidate = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => trusted);
    const store: CatalogStore = {
      load: async () => trusted,
      loadActive: async () => trusted,
      save,
      saveCandidate,
      promoteCandidate,
      rollback,
    };
    const manager = new CatalogManager(store, trusted, {
      baseUrl: "https://api.justoneapi.com",
      openapiUrl: "https://docs.justoneapi.com/openapi.json",
      openapiZhUrl: "https://docs.justoneapi.com/openapi-zh.json",
      catalogRefreshIntervalMs: 0,
      catalogMemoryTtlMs: 60_000,
      debug: false,
      searchV2Enabled: false,
      privateCatalogTerms: [],
      timeoutMs: 1_000,
      retry: 0,
    });

    await expect(manager.refresh()).resolves.toMatchObject({
      success: false,
      error: { code: "SECURITY_CONFIGURATION_REQUIRED" },
    });
    await expect(manager.rollback()).resolves.toMatchObject({
      success: false,
      error: { code: "SECURITY_CONFIGURATION_REQUIRED" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(saveCandidate).not.toHaveBeenCalled();
    expect(promoteCandidate).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });
});
