import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const runtime = resolve(root, ".local-preview");
export const databaseUrl = "postgresql://preview:preview@localhost:5544/creator_preview";
export const integrationNames = ["APIFY_TOKEN", "ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

export function loadSettings() {
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const filename = resolve(runtime, "settings.json");
  if (!existsSync(filename)) {
    writeFileSync(filename, JSON.stringify({
      DATABASE_URL: databaseUrl,
      NEXTAUTH_SECRET: randomBytes(32).toString("base64"),
      NEXTAUTH_URL: "http://localhost:3003",
      APP_URL: "http://localhost:3003",
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      CRON_SECRET: randomBytes(24).toString("hex"),
      ADMIN_EMAIL: "preview@example.test",
      ADMIN_PASSWORD: randomBytes(18).toString("base64url"),
      ADMIN_NAME: "Preview teammate",
      ...Object.fromEntries(integrationNames.map(name => [name, ""])),
    }, null, 2), { mode: 0o600, flag: "wx" });
  }
  const settings = JSON.parse(readFileSync(filename, "utf8"));
  if (settings.DATABASE_URL !== databaseUrl) throw new Error("Preview settings contain a non-preview DATABASE_URL");
  if (settings.APP_URL !== "http://localhost:3003" || settings.NEXTAUTH_URL !== "http://localhost:3003") {
    throw new Error("Preview app URLs must remain http://localhost:3003");
  }
  // Never allow stored settings or inherited integration credentials into preview.
  return { ...settings, ...Object.fromEntries(integrationNames.map(name => [name, ""])) };
}
