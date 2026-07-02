import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const spec = pkg.dependencies["@sendsar/chat-sdk-javascript"] ?? "";
const installed = join(root, "node_modules/@sendsar/chat-sdk-javascript/dist/index.js");

if (existsSync(installed)) {
  process.exit(0);
}

if (!spec.startsWith("file:")) {
  console.error(
    "[ensure:sdk] @sendsar/chat-sdk-javascript is missing. Run: npm install",
  );
  process.exit(1);
}

const sdkPath = join(root, spec.replace("file:", ""));
const sdkDist = join(sdkPath, "dist/index.js");
const monorepoRoot = join(root, "../sendsar-monorepo");

if (existsSync(sdkDist)) {
  process.exit(0);
}

if (!existsSync(monorepoRoot)) {
  console.error(
    "[ensure:sdk] Local SDK not built and sendsar-monorepo not found.\n" +
      "  From npm (default): npm install\n" +
      "  From monorepo: clone sendsar-monorepo next to this repo, then npm run use:local-sdk",
  );
  process.exit(1);
}

console.log("[ensure:sdk] Building @sendsar/chat-sdk-javascript from monorepo…");
const env = { ...process.env, FORCE_COLOR: "1" };

for (const filter of ["@sendsar/protocol", "@sendsar/chat-sdk-javascript"]) {
  const result = spawnSync("pnpm", ["--filter", filter, "build"], {
    cwd: monorepoRoot,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(sdkDist)) {
  console.error("[ensure:sdk] Build finished but dist/index.js is still missing.");
  process.exit(1);
}

console.log("[ensure:sdk] SDK ready.");
