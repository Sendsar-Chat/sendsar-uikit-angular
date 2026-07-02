import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bffDir = join(root, "sample-bff");
const envPath = join(bffDir, ".env");
const examplePath = join(bffDir, ".env.example");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("[setup] Created sample-bff/.env");
  console.log("[setup] → Edit SENDSAR_API_KEY, then run: npm start");
} else {
  console.log("[setup] sample-bff/.env already exists");
}
