import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { assertSafeCatalogValue, configuredPrivateCatalogTerms } from "../src/catalog/security.js";
import { DEFAULT_OPENAPI_URL, DEFAULT_OPENAPI_ZH_URL } from "../src/config.js";
import { bundledCatalog } from "../src/generated/bundledCatalog.js";

async function main() {
  const openapiUrl = process.env.JUSTONEAPI_OPENAPI_URL ?? DEFAULT_OPENAPI_URL;
  const openapiZhUrl = process.env.JUSTONEAPI_OPENAPI_ZH_URL ?? DEFAULT_OPENAPI_ZH_URL;
  const privateTerms = configuredPrivateCatalogTerms(
    process.env.JUSTONEAPI_PRIVATE_CATALOG_TERMS,
    "true"
  );
  const [openapiText, openapiZhText] = await Promise.all([
    fetchText(openapiUrl),
    fetchText(openapiZhUrl),
  ]);
  const expected = buildCatalogBundle({
    openapi: JSON.parse(openapiText),
    openapiZh: JSON.parse(openapiZhText),
    openapiText,
    openapiZhText,
    openapiUrl: publicSourceUrl(openapiUrl, DEFAULT_OPENAPI_URL),
    openapiZhUrl: publicSourceUrl(openapiZhUrl, DEFAULT_OPENAPI_ZH_URL),
    generatedAt: bundledCatalog.meta.generated_at,
    forbiddenTerms: privateTerms,
    requireLocalizedReleaseId: true,
  });
  assertSafeCatalogValue(bundledCatalog, "bundled catalog", privateTerms);

  const mismatches = [
    expected.meta.source.openapi_sha256 === bundledCatalog.meta.source.openapi_sha256
      ? null
      : "English source hash",
    expected.meta.source.openapi_zh_sha256 === bundledCatalog.meta.source.openapi_zh_sha256
      ? null
      : "Chinese source hash",
    expected.meta.endpoint_count === bundledCatalog.meta.endpoint_count ? null : "endpoint count",
    expected.meta.generator_version === bundledCatalog.meta.generator_version
      ? null
      : "generator version",
    expected.meta.release_id === bundledCatalog.meta.release_id ? null : "release ID",
    JSON.stringify(expected.catalog.endpoints) === JSON.stringify(bundledCatalog.catalog.endpoints)
      ? null
      : "catalog payload",
  ].filter((value): value is string => Boolean(value));
  if (mismatches.length) {
    throw new Error(`Bundled catalog is stale: ${mismatches.join(", ")}`);
  }
  console.log(
    `Verified bundled catalog ${bundledCatalog.meta.release_id}: ${bundledCatalog.meta.endpoint_count} endpoints`
  );
}

function publicSourceUrl(source: string, fallback: string): string {
  return source.startsWith("file://") || isAbsolute(source) ? fallback : source;
}

async function fetchText(url: string): Promise<string> {
  if (url.startsWith("file://")) return await readFile(fileURLToPath(url), "utf8");
  if (isAbsolute(url)) return await readFile(url, "utf8");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "justoneapi-mcp/2.0",
    },
  });
  if (!response.ok) throw new Error(`OpenAPI input returned HTTP ${response.status}`);
  return await response.text();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Bundled catalog verification failed");
  process.exit(1);
});
