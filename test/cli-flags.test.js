import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const bin = join(repoRoot, "dist", "index.js");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

function runCli(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, JUSTONEAPI_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1500,
  });
}

test("justoneapi-mcp --help prints usage without requiring a token", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stderr, /JUSTONEAPI_TOKEN is required/);
});

test("justoneapi-mcp --version prints package version without requiring a token", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), packageVersion);
  assert.doesNotMatch(result.stderr, /JUSTONEAPI_TOKEN is required/);
});
