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
import {
  assertCatalogSafetyContext,
  assertPromotedCatalogBundle,
  catalogBundleSha256,
  catalogReleaseAttestation,
  catalogSafetyContext,
  CatalogSafetyContextMismatchError,
} from "./release.js";
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
    const bundle = stored ?? this.safeBundledCatalog();
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
    const previousBundle = previous ?? this.safeBundledCatalog();

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
      const securityChanged =
        JSON.stringify(previousBundle.meta.security) !== JSON.stringify(next.meta.security);
      const needsPromotion = !previous;
      const changed =
        structureChanged ||
        localizationChanged ||
        semanticChanged ||
        generatorChanged ||
        securityChanged ||
        needsPromotion;

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
          : internalMessage.includes("JSON") || internalMessage.includes("x-highlights")
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
    const safety = catalogSafetyContext(this.config.privateCatalogTerms);
    if (this.store.loadPrevious) {
      const preview = await this.store.loadPrevious(safety);
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
      assertPromotedCatalogBundle(preview);
      assertCatalogSafetyContext(preview.meta.security, safety);
    }
    const previous = await this.store.rollback(safety);
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
    assertPromotedCatalogBundle(previous);
    assertCatalogSafetyContext(previous.meta.security, safety);
    this.setMemoryCache(previous);
    return {
      success: true,
      rolled_back: true,
      release_id: previous.meta.release_id,
      endpoint_count: previous.meta.endpoint_count,
    };
  }

  private async safeLoadStore(): Promise<CatalogBundle | null> {
    // Only releases that crossed saveCandidate -> reload -> confidential scan
    // -> promote may be activated here. Never trust the legacy compatibility
    // bundle on a request path: it has no durable promotion attestation. The
    // bundled catalog is release-scanned at build time and is the safe fallback.
    if (!this.config.privateCatalogTerms.length || !this.store.loadPromoted) return null;
    const safety = catalogSafetyContext(this.config.privateCatalogTerms);
    try {
      return await this.store.loadPromoted(safety);
    } catch (error) {
      if (error instanceof CatalogSafetyContextMismatchError) {
        // A newly deployed bundled release may carry the matching registry
        // revision while KV still points at a release attested under the old
        // revision. Only fall back after proving the bundled release matches.
        this.safeBundledCatalog();
      }
      return null;
    }
  }

  private safeBundledCatalog(): CatalogBundle {
    if (this.config.privateCatalogTerms.length) {
      assertPromotedCatalogBundle(this.bundled);
      assertCatalogSafetyContext(
        this.bundled.meta.security,
        catalogSafetyContext(this.config.privateCatalogTerms)
      );
    }
    return this.bundled;
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
      if (catalogBundleSha256(staged) !== catalogBundleSha256(next)) {
        throw new Error("Catalog candidate content verification failed");
      }
      if (bundleSemanticFingerprint(staged) !== bundleSemanticFingerprint(next)) {
        throw new Error("Catalog candidate semantic verification failed");
      }
      await this.store.promoteCandidate(
        catalogReleaseAttestation(staged, this.config.privateCatalogTerms)
      );
      return;
    }
    throw new Error("Catalog store does not support verified candidate promotion");
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
    highlights: normalizeHighlights(endpoint.highlights),
    highlights_en: normalizeHighlights(endpoint.highlights_en),
    endpoint_family: endpoint.endpoint_family,
    recommended: endpoint.recommended,
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
