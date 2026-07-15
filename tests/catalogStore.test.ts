import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { CatalogManager } from "../src/catalog/manager.js";
import { CatalogBundle, CatalogStore } from "../src/catalog/types.js";
import { FileCatalogStore } from "../src/node/fileCatalogStore.js";

const tempDirs: string[] = [];

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
    privateCatalogTerms: ["private-registry-canary"],
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

    await store.save(legacy);
    await store.saveCandidate(next);
    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy title");
    expect((await store.loadCandidate())?.meta.release_id).toBe(next.meta.release_id);

    await store.promoteCandidate(next.meta.release_id!);
    expect((await store.load())?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPrevious())?.catalog.endpoints[0].title_en).toBe("Legacy title");

    const rolledBack = await store.rollback();
    expect(rolledBack?.catalog.endpoints[0].title_en).toBe("Legacy title");
    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy title");
    expect((await store.loadPrevious())?.catalog.endpoints[0].title_en).toBe("New title");
  });

  it("does not report a committed promotion as failed when the legacy mirror cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "justoneapi-mcp-catalog-"));
    tempDirs.push(dir);
    const store = new FileCatalogStore(dir);
    const legacy = bundle("Legacy title", "2026-07-14T00:00:00.000Z");
    const next = bundle("New title", "2026-07-15T00:00:00.000Z");

    await store.saveCandidate(legacy);
    await store.promoteCandidate(legacy.meta.release_id!);
    await store.saveCandidate(next);
    await rm(join(dir, "catalog-bundle.json"), { force: true });
    await mkdir(join(dir, "catalog-bundle.json"));

    await expect(store.promoteCandidate(next.meta.release_id!)).resolves.toBeUndefined();
    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("New title");
    expect((await store.loadPrevious())?.catalog.endpoints[0].title_en).toBe("Legacy title");

    await expect(store.rollback()).resolves.toMatchObject({
      catalog: { endpoints: [expect.objectContaining({ title_en: "Legacy title" })] },
    });
    expect((await store.loadActive())?.catalog.endpoints[0].title_en).toBe("Legacy title");
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
    expect(promoteCandidate).toHaveBeenCalledWith(result.release_id);
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
    expect(promoteCandidate).toHaveBeenCalledWith(result.release_id);
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
    const privateTerm = "PRIVATE_REGISTRY_CANARY";
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
