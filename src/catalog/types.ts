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

export type EndpointCatalogEntry = {
  endpoint_id: string;
  platform: string;
  platform_name: string;
  platform_aliases: string[];
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
  highlights: string[];
  highlights_en: string[];
  params: EndpointParam[];
  search_tokens: string[];
  pagination?: EndpointPagination;
};

export type EndpointCatalog = {
  endpoints: EndpointCatalogEntry[];
};

export type CatalogMeta = {
  generated_at: string;
  endpoint_count: number;
  source: {
    openapi_url: string;
    openapi_zh_url: string;
    openapi_sha256: string;
    openapi_zh_sha256?: string;
  };
  localization_available: boolean;
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
  warning?: string;
  error?: {
    code: string;
    message: string;
  };
};

export type CatalogStore = {
  load(): Promise<CatalogBundle | null>;
  save(bundle: CatalogBundle): Promise<void>;
  loadLastRefresh?(): Promise<unknown | null>;
  saveLastRefresh?(value: unknown): Promise<void>;
  tryAcquireRefreshLock?(ttlMs: number): Promise<boolean>;
  releaseRefreshLock?(): Promise<void>;
};
