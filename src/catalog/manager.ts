import { AppConfig } from "../config.js";
import { buildCatalogBundle } from "./build.js";
import { fetchOpenApiDocuments } from "./fetchOpenapi.js";
import { CatalogBundle, CatalogStore, EndpointCatalogEntry, RefreshResult } from "./types.js";

export class CatalogManager {
  private cached: CatalogBundle | null = null;
  private cachedAt = 0;

  constructor(
    private readonly store: CatalogStore,
    private readonly bundled: CatalogBundle,
    private readonly config: AppConfig
  ) {}

  async load(force = false): Promise<CatalogBundle> {
    const now = Date.now();
    if (!force && this.cached && now - this.cachedAt <= this.config.catalogMemoryTtlMs) {
      return this.cached;
    }

    const stored = await this.safeLoadStore();
    const bundle = stored ?? this.bundled;
    if (!bundle.catalog.endpoints.length) {
      throw new Error("Catalog is empty");
    }

    this.cached = bundle;
    this.cachedAt = now;
    return bundle;
  }

  async getEndpoint(endpointId: string): Promise<EndpointCatalogEntry | null> {
    const bundle = await this.load();
    return bundle.catalog.endpoints.find((endpoint) => endpoint.endpoint_id === endpointId) ?? null;
  }

  setMemoryCache(bundle: CatalogBundle) {
    this.cached = bundle;
    this.cachedAt = Date.now();
  }

  async refresh(trigger: "manual" | "cron" | "startup" = "manual"): Promise<RefreshResult> {
    const previous = await this.safeLoadStore();
    const previousBundle = previous ?? this.bundled;

    let lockAcquired = false;
    if (this.store.tryAcquireRefreshLock) {
      lockAcquired = await this.store.tryAcquireRefreshLock(5 * 60 * 1000);
      if (!lockAcquired) {
        return {
          success: true,
          changed: false,
          structure_changed: false,
          localization_changed: false,
          endpoint_count: previousBundle.meta.endpoint_count,
          previous_endpoint_count: previousBundle.meta.endpoint_count,
          added: [],
          removed: [],
          modified: [],
          warning: "catalog refresh already in progress",
        };
      }
    }

    const started = Date.now();
    try {
      const docs = await fetchOpenApiDocuments(this.config);
      const openapi = JSON.parse(docs.openapiText);
      const openapiZh = docs.openapiZhText ? JSON.parse(docs.openapiZhText) : null;
      const next = buildCatalogBundle({
        openapi,
        openapiZh,
        openapiText: docs.openapiText,
        openapiZhText: docs.openapiZhText,
        openapiUrl: this.config.openapiUrl,
        openapiZhUrl: this.config.openapiZhUrl,
      });

      const structureChanged =
        previousBundle.meta.source.openapi_sha256 !== next.meta.source.openapi_sha256;
      const localizationChanged =
        previousBundle.meta.source.openapi_zh_sha256 !== next.meta.source.openapi_zh_sha256;
      const changed = structureChanged || localizationChanged;
      const diff = diffBundles(previousBundle, next);

      if (changed) {
        await this.store.save(next);
        this.setMemoryCache(next);
      }

      const result: RefreshResult = {
        success: true,
        changed,
        structure_changed: structureChanged,
        localization_changed: localizationChanged,
        endpoint_count: next.meta.endpoint_count,
        previous_endpoint_count: previousBundle.meta.endpoint_count,
        generated_at: next.meta.generated_at,
        warning: docs.warning,
        ...diff,
      };
      await this.store.saveLastRefresh?.({
        ...result,
        trigger,
        duration_ms: Date.now() - started,
        time: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown catalog refresh error";
      const result: RefreshResult = {
        success: false,
        changed: false,
        structure_changed: false,
        localization_changed: false,
        endpoint_count: previousBundle.meta.endpoint_count,
        previous_endpoint_count: previousBundle.meta.endpoint_count,
        added: [],
        removed: [],
        modified: [],
        error: {
          code: message.includes("JSON") ? "OPENAPI_PARSE_FAILED" : "OPENAPI_FETCH_FAILED",
          message,
        },
      };
      await this.store.saveLastRefresh?.({
        ...result,
        trigger,
        duration_ms: Date.now() - started,
        time: new Date().toISOString(),
      });
      return result;
    } finally {
      if (lockAcquired) {
        await this.store.releaseRefreshLock?.();
      }
    }
  }

  async loadLastRefresh(): Promise<unknown | null> {
    return (await this.store.loadLastRefresh?.()) ?? null;
  }

  private async safeLoadStore(): Promise<CatalogBundle | null> {
    try {
      return await this.store.load();
    } catch {
      return null;
    }
  }
}

function diffBundles(previous: CatalogBundle, next: CatalogBundle) {
  const oldMap = new Map(
    previous.catalog.endpoints.map((endpoint) => [endpoint.endpoint_id, endpoint])
  );
  const newMap = new Map(
    next.catalog.endpoints.map((endpoint) => [endpoint.endpoint_id, endpoint])
  );
  const added = [...newMap.keys()].filter((id) => !oldMap.has(id)).sort();
  const removed = [...oldMap.keys()].filter((id) => !newMap.has(id)).sort();
  const modified = [...newMap.keys()]
    .filter((id) => oldMap.has(id) && signature(oldMap.get(id)!) !== signature(newMap.get(id)!))
    .sort();

  return { added, removed, modified };
}

function signature(endpoint: EndpointCatalogEntry): string {
  return JSON.stringify({
    path: endpoint.path,
    method: endpoint.method,
    title: endpoint.title_en,
    params: endpoint.params.map((param) => ({
      name: param.name,
      api_name: param.api_name,
      in: param.in,
      required: param.required,
      type: param.type,
      enum: param.enum,
    })),
  });
}
