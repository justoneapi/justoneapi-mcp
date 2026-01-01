import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let version = "0.0.0";

try {
  const packageJsonPath = join(__dirname, "../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  version = packageJson.version || "0.0.0";
} catch (e) {
  console.error("Failed to read version from package.json:", e);
}

export { version };
