export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EndpointParam = {
  name: string;
  api_name: string;
  in: "query" | "path" | "header" | "body";
  required: boolean;
  type: string;
  format?: string;
  default?: JsonValue;
  enum?: JsonValue[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  min_length?: number;
  max_length?: number;
  description: string;
  description_en: string;
};

export type EndpointPagination = {
  type: "page" | "cursor" | "offset" | "compound" | "unknown";
  params: string[];
};

export type HighlightKind = "CAPABILITY" | "LIMITATION" | "CONDITION" | "GUIDANCE";

export type EndpointHighlight = {
  type: "INFO" | "TIP" | "WARNING" | "DANGER";
  title?: string;
  content: string;
  kind: HighlightKind;
  concept?: string;
  aliases?: string[];
  fieldPaths?: string[];
};

/**
 * Catalogs generated before structured highlights used plain strings. The
 * runtime accepts those cached catalogs and projects them as GUIDANCE.
 */
export type EndpointHighlightInput = EndpointHighlight | string;

export type EndpointContractStatus = {
  status: "verified" | "partial" | "pending" | "stale";
  reason?: string;
  revision?: string;
};

export type EndpointUseCase = {
  id?: string;
  title?: string;
  title_en?: string;
  description?: string;
  description_en?: string;
  aliases?: string[];
};

export type EndpointKeyResponseField = {
  path?: string;
  name?: string;
  name_en?: string;
  description?: string;
  description_en?: string;
  aliases?: string[];
  availability?: string;
};

export type EndpointCatalogEntry = {
  endpoint_id: string;
  platform: string;
  platform_name: string;
  platform_description?: string;
  platform_description_en?: string;
  platform_aliases: string[];
  platform_detection_aliases?: string[];
  method_name: string;
  operation_id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  version: string;
  title: string;
  title_en: string;
  description: string;
  description_en: string;
  tags: string[];
  tags_en: string[];
  order: number;
  hidden: boolean;
  deprecated: boolean;
  recommended: boolean;
  content_type?: string;
  highlights: EndpointHighlightInput[];
  highlights_en: EndpointHighlightInput[];
  search_aliases?: string[];
  use_cases?: EndpointUseCase[];
  key_response_fields?: EndpointKeyResponseField[];
  endpoint_family?: string;
  contract_status?: EndpointContractStatus;
  response_schema?: JsonValue;
  response_schema_hash?: string;
  response_example?: JsonValue;
  params: EndpointParam[];
  search_tokens: string[];
  pagination?: EndpointPagination;
};

export type EndpointCatalog = {
  endpoints: EndpointCatalogEntry[];
};

export type CatalogMeta = {
  release_id?: string;
  generator_version?: string;
  generated_at: string;
  endpoint_count: number;
  source: {
    openapi_url: string;
    openapi_zh_url: string;
    openapi_sha256: string;
    openapi_zh_sha256?: string;
  };
  localization_available: boolean;
  security?: CatalogSafetyContext;
};

export type CatalogSafetyContext = {
  registry_revision: string;
  safety_policy_version: string;
};

export type CatalogReleaseAttestation = CatalogSafetyContext & {
  release_id: string;
  content_sha256: string;
};

export type CatalogBundle = {
  catalog: EndpointCatalog;
  meta: CatalogMeta;
};

export type RefreshResult = {
  success: boolean;
  changed: boolean;
  structure_changed: boolean;
  localization_changed: boolean;
  endpoint_count: number;
  previous_endpoint_count: number;
  added: string[];
  removed: string[];
  modified: string[];
  generated_at?: string;
  release_id?: string;
  warning?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type CatalogRollbackResult = {
  success: boolean;
  rolled_back: boolean;
  release_id?: string;
  endpoint_count: number;
  error?: { code: string; message: string };
};

export type CatalogStore = {
  load(): Promise<CatalogBundle | null>;
  save(bundle: CatalogBundle): Promise<void>;
  /** Load only an immutable release selected by the promoted active pointer. */
  loadPromoted?(safety: CatalogSafetyContext): Promise<CatalogBundle | null>;
  loadActive?(): Promise<CatalogBundle | null>;
  loadPrevious?(safety: CatalogSafetyContext): Promise<CatalogBundle | null>;
  loadCandidate?(): Promise<CatalogBundle | null>;
  saveCandidate?(bundle: CatalogBundle): Promise<void>;
  promoteCandidate?(attestation: CatalogReleaseAttestation): Promise<void>;
  rollback?(safety: CatalogSafetyContext): Promise<CatalogBundle | null>;
  loadLastRefresh?(): Promise<unknown | null>;
  saveLastRefresh?(value: unknown): Promise<void>;
  tryAcquireRefreshLock?(ttlMs: number): Promise<boolean>;
  releaseRefreshLock?(): Promise<void>;
};
