import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
    fetchText(openapiZhUrl).catch((error) => {
      console.warn(`Failed to fetch Chinese OpenAPI: ${error}`);
      return null;
    }),
  ]);

  const bundle = buildCatalogBundle({
    openapi: JSON.parse(openapiText),
    openapiZh: openapiZhText ? JSON.parse(openapiZhText) : null,
    openapiText,
    openapiZhText,
    openapiUrl,
    openapiZhUrl,
  });

  const outputPath = resolve(root, "src/generated/bundledCatalog.ts");
  const source = `import { CatalogBundle } from "../catalog/types.js";

export const bundledCatalog: CatalogBundle = ${JSON.stringify(bundle, null, 2)};
`;
  await writeFile(outputPath, source, "utf8");
  console.log(`Generated bundled catalog: ${bundle.meta.endpoint_count} endpoints`);
}

async function fetchText(url: string): Promise<string> {
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
