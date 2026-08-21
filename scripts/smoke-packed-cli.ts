import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { createInterface } from "node:readline";

const installRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new TypeError("Temporary install directory is required");

const packageRoot = resolve(installRoot, "node_modules/justoneapi-mcp");
const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")) as {
  version?: string;
  dependencies?: Record<string, string>;
};
if (typeof packageJson.version !== "string") throw new Error("Packed CLI version is missing");

const forbiddenProductionPackages = new Set([
  "agents",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/sdk",
  "jose",
]);
for (const name of forbiddenProductionPackages) {
  if (packageJson.dependencies?.[name]) {
    throw new Error(`Packed CLI has a forbidden runtime dependency: ${name}`);
  }
}
if (packageJson.dependencies?.["@modelcontextprotocol/server"] !== "2.0.0") {
  throw new Error("Packed CLI must use @modelcontextprotocol/server 2.0.0");
}

const installedFiles = await filesRecursively(packageRoot);
for (const file of installedFiles) {
  const path = relative(packageRoot, file).split(sep).join("/");
  if (
    path === "dist/src/worker.js" ||
    path.startsWith("dist/src/worker/") ||
    path.startsWith("dist/scripts/") ||
    path.startsWith("scripts/") ||
    path === "wrangler.jsonc" ||
    path === "worker-configuration.d.ts"
  ) {
    throw new Error(`Packed CLI contains a Worker/build-only file: ${path}`);
  }
}

const npmTreeResult = spawnSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
  cwd: installRoot,
  encoding: "utf8",
});
if (npmTreeResult.status !== 0) {
  throw new Error(`Production npm tree is invalid: ${npmTreeResult.stderr.trim()}`);
}
const npmTree = JSON.parse(npmTreeResult.stdout) as DependencyNode;
const productionPackages = collectDependencies(npmTree);
for (const name of forbiddenProductionPackages) {
  if (productionPackages.has(name)) {
    throw new Error(`Production npm tree contains a forbidden package: ${name}`);
  }
}
if (!productionPackages.has("@modelcontextprotocol/server")) {
  throw new Error("Production npm tree is missing @modelcontextprotocol/server");
}

await smokeStdio(resolve(packageRoot, "dist/src/index.js"), packageJson.version);
console.log("Packed CLI clean-install and stdio smoke passed.");

type DependencyNode = {
  dependencies?: Record<string, DependencyNode>;
};

function collectDependencies(root: DependencyNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: DependencyNode) => {
    for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
      names.add(name);
      visit(dependency);
    }
  };
  visit(root);
  return names;
}

async function smokeStdio(entry: string, expectedVersion: string | undefined): Promise<void> {
  const childEnvironment: Record<string, string | undefined> = { ...process.env };
  childEnvironment.JUSTONEAPI_TOKEN = "A".repeat(16);
  childEnvironment.JUSTONEAPI_CATALOG_REFRESH_INTERVAL_MS = "0";
  childEnvironment.JUSTONEAPI_DEBUG = "false";
  const child = spawn(process.execPath, [entry], {
    cwd: installRoot,
    env: childEnvironment as unknown as NodeJS.ProcessEnv,
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 8_192) stderr += chunk.toString();
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("exit", (code, signal) => done({ code, signal }));
  });

  await new Promise<void>((done, reject) => {
    let initialized = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else done();
    };
    const timer = setTimeout(
      () => finish(new Error(`Packed CLI smoke timed out: ${stderr}`)),
      10_000
    );

    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(new Error(`Packed CLI exited before tools/list: code=${code} signal=${signal}`));
      }
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        finish(new Error("Packed CLI wrote non-JSON data to stdout"));
        return;
      }

      if (message.id === 1) {
        const result = record(message.result, "initialize result");
        const serverInfo = record(result.serverInfo, "initialize serverInfo");
        if (result.protocolVersion !== "2025-06-18" || serverInfo.version !== expectedVersion) {
          finish(new Error("Packed CLI initialize response has the wrong protocol or version"));
          return;
        }
        initialized = true;
        writeMessage(child, {
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        });
        writeMessage(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (message.id === 2) {
        if (!initialized) {
          finish(new Error("Packed CLI returned tools/list before initialize"));
          return;
        }
        const result = record(message.result, "tools/list result");
        if (!Array.isArray(result.tools)) {
          finish(new Error("Packed CLI tools/list response is missing tools"));
          return;
        }
        const tools = result.tools.map((value) => record(value, "tool descriptor"));
        const names = tools.map((tool) => tool.name);
        for (const required of [
          "search_endpoints",
          "get_endpoint_schema",
          "call_endpoint",
          "refresh_catalog",
        ]) {
          if (!names.includes(required)) {
            finish(new Error(`Packed CLI tools/list is missing ${required}`));
            return;
          }
        }
        const callEndpoint = tools.find((tool) => tool.name === "call_endpoint");
        const metadata = record(callEndpoint?._meta, "call_endpoint metadata");
        if (JSON.stringify(metadata.securitySchemes) !== JSON.stringify([{ type: "noauth" }])) {
          finish(new Error("Packed CLI call_endpoint does not advertise stdio noauth"));
          return;
        }
        finish();
      }
    });

    writeMessage(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "packed-cli-smoke", version: "1.0.0" },
      },
    });
  }).catch((error) => {
    child.kill("SIGKILL");
    throw error;
  });

  child.kill("SIGTERM");
  let exitTimer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    exit,
    new Promise<never>(
      (_done, reject) =>
        (exitTimer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Packed CLI did not exit after SIGTERM"));
        }, 5_000))
    ),
  ]);
  if (exitTimer) clearTimeout(exitTimer);
  lines.close();
  if (result.code !== 0) {
    throw new Error(
      `Packed CLI exited unsuccessfully: code=${result.code} signal=${result.signal}`
    );
  }
}

function writeMessage(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>
): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
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
