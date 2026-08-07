import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first, fall back to .env
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // This app shares a Neon instance with social-analytics-dashboard (sa_*) and
  // Bulk Ads Uploader (unprefixed users / agency_settings). Only cm_* tables are
  // ours to manage — everything else is re-declared read-only for FK references.
  tablesFilter: ["cm_*"],
});
