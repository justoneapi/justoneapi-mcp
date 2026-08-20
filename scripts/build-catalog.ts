import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogBundle } from "../src/catalog/build.js";
import { DEFAULT_OPENAPI_URL, DEFAULT_OPENAPI_ZH_URL } from "../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

async function main() {
  const openapiUrl = process.env.JUSTONEAPI_OPENAPI_URL ?? DEFAULT_OPENAPI_URL;
  const openapiZhUrl = process.env.JUSTONEAPI_OPENAPI_ZH_URL ?? DEFAULT_OPENAPI_ZH_URL;
  const [openapiText, openapiZhText] = await Promise.all([
    fetchText(openapiUrl),
    fetchText(openapiZhUrl),
  ]);

  const bundle = buildCatalogBundle({
    openapi: JSON.parse(openapiText),
    openapiZh: JSON.parse(openapiZhText),
    openapiText,
    openapiZhText,
    openapiUrl: publicSourceUrl(openapiUrl, DEFAULT_OPENAPI_URL),
    openapiZhUrl: publicSourceUrl(openapiZhUrl, DEFAULT_OPENAPI_ZH_URL),
    requireLocalizedReleaseId: true,
  });

  const outputPath = resolve(root, "src/generated/bundledCatalog.ts");
  const source = `import { CatalogBundle } from "../catalog/types.js";

export const bundledCatalog: CatalogBundle = ${JSON.stringify(bundle, null, 2)};
`;
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, source, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  console.log(`Generated bundled catalog: ${bundle.meta.endpoint_count} endpoints`);
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
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.text();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
