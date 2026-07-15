import { AppConfig } from "../config.js";
import { buildCatalogBundle } from "./build.js";
import { fetchOpenApiDocuments } from "./fetchOpenapi.js";
import {
  CatalogBundle,
  CatalogRollbackResult,
  CatalogStore,
  EndpointCatalogEntry,
  RefreshResult,
} from "./types.js";
import { normalizeHighlights } from "./highlights.js";
import { schemaHash } from "./schema.js";
import { assertSafeCatalogValue } from "./security.js";

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
    assertSafeCatalogValue(bundle, "loaded catalog", this.config.privateCatalogTerms);

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
    if (!this.config.privateCatalogTerms.length) {
      const endpointCount = this.bundled.meta.endpoint_count;
      const result: RefreshResult = {
        success: false,
        changed: false,
        structure_changed: false,
        localization_changed: false,
        endpoint_count: endpointCount,
        previous_endpoint_count: endpointCount,
        added: [],
        removed: [],
        modified: [],
        error: {
          code: "SECURITY_CONFIGURATION_REQUIRED",
          message: "Dynamic catalog refresh requires the private catalog security registry.",
        },
      };
      await this.saveLastRefreshBestEffort({
        ...result,
        trigger,
        duration_ms: 0,
        time: new Date().toISOString(),
      });
      return result;
    }
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
      const openapiZh = JSON.parse(docs.openapiZhText);
      const next = buildCatalogBundle({
        openapi,
        openapiZh,
        openapiText: docs.openapiText,
        openapiZhText: docs.openapiZhText,
        openapiUrl: this.config.openapiUrl,
        openapiZhUrl: this.config.openapiZhUrl,
        forbiddenTerms: this.config.privateCatalogTerms,
        requireLocalizedReleaseId: true,
      });

      const structureChanged =
        previousBundle.meta.source.openapi_sha256 !== next.meta.source.openapi_sha256;
      const localizationChanged =
        previousBundle.meta.source.openapi_zh_sha256 !== next.meta.source.openapi_zh_sha256;
      const diff = diffBundles(previousBundle, next);
      const semanticChanged = Boolean(
        diff.added.length || diff.removed.length || diff.modified.length
      );
      const generatorChanged =
        previousBundle.meta.generator_version !== next.meta.generator_version;
      const changed =
        structureChanged || localizationChanged || semanticChanged || generatorChanged;

      if (changed) {
        await this.publishCandidate(next);
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
        release_id: changed ? next.meta.release_id : previousBundle.meta.release_id,
        ...diff,
      };
      await this.saveLastRefreshBestEffort({
        ...result,
        trigger,
        duration_ms: Date.now() - started,
        time: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const internalMessage =
        error instanceof Error ? error.message : "Unknown catalog refresh error";
      const code =
        internalMessage.startsWith("Unsafe") ||
        internalMessage.includes("public catalog") ||
        internalMessage.startsWith("Registered private term") ||
        internalMessage.startsWith("Non-public URL") ||
        internalMessage.startsWith("Credential-bearing URL")
          ? "CATALOG_UNSAFE"
          : internalMessage.includes("JSON") ||
              internalMessage.includes("x-highlights") ||
              internalMessage.includes("x-contract-status")
            ? "OPENAPI_PARSE_FAILED"
            : "OPENAPI_FETCH_FAILED";
      const message =
        code === "CATALOG_UNSAFE"
          ? "Catalog refresh failed public safety validation."
          : code === "OPENAPI_PARSE_FAILED"
            ? "Catalog refresh could not parse the OpenAPI release."
            : "Catalog refresh failed.";
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
          code,
          message,
        },
      };
      await this.saveLastRefreshBestEffort({
        ...result,
        trigger,
        duration_ms: Date.now() - started,
        time: new Date().toISOString(),
      });
      return result;
    } finally {
      if (lockAcquired) {
        try {
          await this.store.releaseRefreshLock?.();
        } catch {
          // Lock cleanup is best-effort and must not overwrite a committed
          // promotion result. The lock has a finite TTL as a final safeguard.
        }
      }
    }
  }

  async loadLastRefresh(): Promise<unknown | null> {
    return (await this.store.loadLastRefresh?.()) ?? null;
  }

  async rollback(): Promise<CatalogRollbackResult> {
    if (!this.config.privateCatalogTerms.length) {
      return {
        success: false,
        rolled_back: false,
        endpoint_count: this.bundled.meta.endpoint_count,
        error: {
          code: "SECURITY_CONFIGURATION_REQUIRED",
          message: "Catalog rollback requires the private catalog security registry.",
        },
      };
    }
    if (!this.store.rollback) {
      return {
        success: false,
        rolled_back: false,
        endpoint_count: (await this.load()).meta.endpoint_count,
        error: {
          code: "CATALOG_ROLLBACK_UNSUPPORTED",
          message: "The configured catalog store does not support rollback.",
        },
      };
    }
    if (this.store.loadPrevious) {
      const preview = await this.store.loadPrevious();
      if (!preview) {
        return {
          success: false,
          rolled_back: false,
          endpoint_count: (await this.load()).meta.endpoint_count,
          error: {
            code: "CATALOG_PREVIOUS_NOT_FOUND",
            message: "No previous catalog release is available.",
          },
        };
      }
      assertSafeCatalogValue(
        preview,
        "rollback candidate catalog",
        this.config.privateCatalogTerms
      );
    }
    const previous = await this.store.rollback();
    if (!previous) {
      return {
        success: false,
        rolled_back: false,
        endpoint_count: (await this.load()).meta.endpoint_count,
        error: {
          code: "CATALOG_PREVIOUS_NOT_FOUND",
          message: "No previous catalog release is available.",
        },
      };
    }
    assertSafeCatalogValue(previous, "rollback catalog", this.config.privateCatalogTerms);
    this.setMemoryCache(previous);
    return {
      success: true,
      rolled_back: true,
      release_id: previous.meta.release_id,
      endpoint_count: previous.meta.endpoint_count,
    };
  }

  private async safeLoadStore(): Promise<CatalogBundle | null> {
    // A persisted or remote catalog has runtime provenance that the bundled,
    // release-scanned catalog does not. Without the confidential registry we
    // cannot validate unknown private identifiers, so only the bundled catalog
    // may be activated for discovery.
    if (!this.config.privateCatalogTerms.length) return null;
    try {
      const bundle = this.store.loadActive
        ? await this.store.loadActive()
        : await this.store.load();
      if (bundle) {
        assertSafeCatalogValue(bundle, "stored catalog", this.config.privateCatalogTerms);
      }
      return bundle;
    } catch {
      return null;
    }
  }

  private async publishCandidate(next: CatalogBundle): Promise<void> {
    if (
      this.store.saveCandidate &&
      this.store.loadCandidate &&
      this.store.promoteCandidate &&
      next.meta.release_id
    ) {
      await this.store.saveCandidate(next);
      const staged = await this.store.loadCandidate();
      if (!staged) throw new Error("Catalog candidate could not be reloaded");
      if (staged.meta.release_id !== next.meta.release_id) {
        throw new Error("Catalog candidate release verification failed");
      }
      assertSafeCatalogValue(staged, "candidate catalog", this.config.privateCatalogTerms);
      if (bundleSemanticFingerprint(staged) !== bundleSemanticFingerprint(next)) {
        throw new Error("Catalog candidate semantic verification failed");
      }
      await this.store.promoteCandidate(next.meta.release_id);
      return;
    }
    await this.store.save(next);
  }

  private async saveLastRefreshBestEffort(value: unknown): Promise<void> {
    try {
      await this.store.saveLastRefresh?.(value);
    } catch {
      // Refresh telemetry is not part of the atomic catalog release. Never
      // convert a committed promotion into a reported failure.
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
    .filter(
      (id) =>
        oldMap.has(id) &&
        catalogSemanticSignature(oldMap.get(id)!) !== catalogSemanticSignature(newMap.get(id)!)
    )
    .sort();

  return { added, removed, modified };
}

export function catalogSemanticSignature(endpoint: EndpointCatalogEntry): string {
  return JSON.stringify({
    path: endpoint.path,
    method: endpoint.method,
    operation_id: endpoint.operation_id,
    version: endpoint.version,
    title: endpoint.title,
    title_en: endpoint.title_en,
    description: endpoint.description,
    description_en: endpoint.description_en,
    deprecated: endpoint.deprecated,
    content_type: endpoint.content_type,
    platform_aliases: endpoint.platform_aliases,
    platform_detection_aliases: endpoint.platform_detection_aliases ?? [],
    platform_description: endpoint.platform_description,
    platform_description_en: endpoint.platform_description_en,
    search_aliases: endpoint.search_aliases ?? [],
    use_cases: endpoint.use_cases ?? [],
    key_response_fields: endpoint.key_response_fields ?? [],
    highlights: normalizeHighlights(endpoint.highlights),
    highlights_en: normalizeHighlights(endpoint.highlights_en),
    endpoint_family: endpoint.endpoint_family,
    recommended: endpoint.recommended,
    contract_status: endpoint.contract_status,
    response_schema_hash: endpoint.response_schema_hash ?? schemaHash(endpoint.response_schema),
    params: endpoint.params.map((param) => ({
      name: param.name,
      api_name: param.api_name,
      in: param.in,
      required: param.required,
      type: param.type,
      format: param.format,
      default: param.default,
      enum: param.enum,
      nullable: param.nullable,
      minimum: param.minimum,
      maximum: param.maximum,
      min_length: param.min_length,
      max_length: param.max_length,
      description: param.description,
      description_en: param.description_en,
    })),
  });
}

function bundleSemanticFingerprint(bundle: CatalogBundle): string {
  return JSON.stringify({
    endpoint_count: bundle.meta.endpoint_count,
    openapi_sha256: bundle.meta.source.openapi_sha256,
    openapi_zh_sha256: bundle.meta.source.openapi_zh_sha256,
    generator_version: bundle.meta.generator_version,
    endpoints: bundle.catalog.endpoints.map((endpoint) => [
      endpoint.endpoint_id,
      catalogSemanticSignature(endpoint),
    ]),
  });
}
