import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CatalogBundle, CatalogStore } from "../catalog/types.js";

const BUNDLE_FILE = "catalog-bundle.json";
const LAST_REFRESH_FILE = "catalog-last-refresh.json";
const LOCK_FILE = "catalog-refresh-lock.json";

export class FileCatalogStore implements CatalogStore {
  constructor(private readonly dir: string = defaultCacheDir()) {}

  async load(): Promise<CatalogBundle | null> {
    return await this.readJson<CatalogBundle>(BUNDLE_FILE);
  }

  async save(bundle: CatalogBundle): Promise<void> {
    await this.writeJson(BUNDLE_FILE, bundle);
  }

  async loadLastRefresh(): Promise<unknown | null> {
    return await this.readJson<unknown>(LAST_REFRESH_FILE);
  }

  async saveLastRefresh(value: unknown): Promise<void> {
    await this.writeJson(LAST_REFRESH_FILE, value);
  }

  async tryAcquireRefreshLock(ttlMs: number): Promise<boolean> {
    const existing = await this.readJson<{ expires_at: number }>(LOCK_FILE);
    if (existing && existing.expires_at > Date.now()) return false;
    await this.writeJson(LOCK_FILE, { expires_at: Date.now() + ttlMs });
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    await rm(join(this.dir, LOCK_FILE), { force: true });
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      const text = await readFile(join(this.dir, file), "utf8");
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, file);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }
}

function defaultCacheDir(): string {
  if (process.env.JUSTONEAPI_CATALOG_CACHE_DIR) {
    return process.env.JUSTONEAPI_CATALOG_CACHE_DIR;
  }
  return join(homedir(), ".cache", "justoneapi-mcp");
}
