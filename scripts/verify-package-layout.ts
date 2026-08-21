import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const distRoot = resolve(projectRoot, "dist");
const entry = resolve(distRoot, "src/index.js");
const forbiddenPaths = [resolve(distRoot, "src/worker.js"), resolve(distRoot, "src/worker")];

await requireFile(entry, "CLI entrypoint is missing; run npm run build:cli first");
for (const path of forbiddenPaths) {
  if (await exists(path)) {
    throw new Error(`Worker-only output must not be included in the npm package: ${path}`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
for (const dependency of [
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/sdk",
  "agents",
  "jose",
]) {
  if (packageJson.dependencies?.[dependency]) {
    throw new Error(
      `Worker/test-only dependency must not ship as an npm runtime dependency: ${dependency}`
    );
  }
}

for (const path of await filesRecursively(distRoot)) {
  if (!path.endsWith(".js")) continue;
  const source = await readFile(path, "utf8");
  if (/from ["'](?:agents|jose)(?:\/|["'])/.test(source)) {
    throw new Error(`CLI output imports a Worker-only package: ${path}`);
  }
}

async function requireFile(path: string, message: string): Promise<void> {
  if (!(await exists(path)) || !(await stat(path)).isFile()) throw new Error(message);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function filesRecursively(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
