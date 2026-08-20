import "dotenv/config";

export const DEFAULT_BASE_URL = "https://api.justoneapi.com";
export const DEFAULT_OPENAPI_URL = "https://docs.justoneapi.com/openapi.json";
export const DEFAULT_OPENAPI_ZH_URL = "https://docs.justoneapi.com/openapi-zh.json";

export type AppConfig = {
  baseUrl: string;
  openapiUrl: string;
  openapiZhUrl: string;
  catalogRefreshIntervalMs: number;
  catalogMemoryTtlMs: number;
  catalogCacheDir?: string;
  adminToken?: string;
  debug: boolean;
  searchV2Enabled: boolean;
  timeoutMs: number;
  retry: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadNodeConfig(): AppConfig {
  return {
    baseUrl: process.env.JUSTONEAPI_BASE_URL ?? DEFAULT_BASE_URL,
    openapiUrl: process.env.JUSTONEAPI_OPENAPI_URL ?? DEFAULT_OPENAPI_URL,
    openapiZhUrl: process.env.JUSTONEAPI_OPENAPI_ZH_URL ?? DEFAULT_OPENAPI_ZH_URL,
    catalogRefreshIntervalMs: numberFromEnv(
      "JUSTONEAPI_CATALOG_REFRESH_INTERVAL_MS",
      60 * 60 * 1000
    ),
    catalogMemoryTtlMs: numberFromEnv("JUSTONEAPI_CATALOG_MEMORY_TTL_MS", 60 * 1000),
    catalogCacheDir: process.env.JUSTONEAPI_CATALOG_CACHE_DIR,
    adminToken: process.env.JUSTONEAPI_ADMIN_TOKEN,
    debug: (process.env.JUSTONEAPI_DEBUG ?? "").toLowerCase() === "true",
    searchV2Enabled: (process.env.JUSTONEAPI_SEARCH_V2_ENABLED ?? "").toLowerCase() === "true",
    timeoutMs: numberFromEnv("JUSTONEAPI_TIMEOUT_MS", 60000),
    retry: numberFromEnv("JUSTONEAPI_RETRY", 1),
  };
}

export function loadWorkerConfig(env: {
  JUSTONEAPI_BASE_URL?: string;
  JUSTONEAPI_OPENAPI_URL?: string;
  JUSTONEAPI_OPENAPI_ZH_URL?: string;
  JUSTONEAPI_CATALOG_REFRESH_INTERVAL_MS?: string;
  JUSTONEAPI_CATALOG_MEMORY_TTL_MS?: string;
  JUSTONEAPI_ADMIN_TOKEN?: string;
  JUSTONEAPI_DEBUG?: string;
  JUSTONEAPI_SEARCH_V2_ENABLED?: string;
  JUSTONEAPI_TIMEOUT_MS?: string;
  JUSTONEAPI_RETRY?: string;
}): AppConfig {
  const getNumber = (name: keyof typeof env, fallback: number) => {
    const value = env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return {
    baseUrl: env.JUSTONEAPI_BASE_URL ?? DEFAULT_BASE_URL,
    openapiUrl: env.JUSTONEAPI_OPENAPI_URL ?? DEFAULT_OPENAPI_URL,
    openapiZhUrl: env.JUSTONEAPI_OPENAPI_ZH_URL ?? DEFAULT_OPENAPI_ZH_URL,
    catalogRefreshIntervalMs: getNumber("JUSTONEAPI_CATALOG_REFRESH_INTERVAL_MS", 60 * 60 * 1000),
    catalogMemoryTtlMs: getNumber("JUSTONEAPI_CATALOG_MEMORY_TTL_MS", 60 * 1000),
    adminToken: env.JUSTONEAPI_ADMIN_TOKEN,
    debug: (env.JUSTONEAPI_DEBUG ?? "").toLowerCase() === "true",
    searchV2Enabled: (env.JUSTONEAPI_SEARCH_V2_ENABLED ?? "").toLowerCase() === "true",
    timeoutMs: getNumber("JUSTONEAPI_TIMEOUT_MS", 60000),
    retry: getNumber("JUSTONEAPI_RETRY", 1),
  };
}
