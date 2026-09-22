import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  if (process.env.CREATOR_LOCAL_PREVIEW !== "1") return {};
  if (process.env.DATABASE_URL !== "postgresql://preview:preview@localhost:5544/creator_preview") {
    throw new Error("The isolated creator preview requires its local preview database");
  }

  // Synthetic preview data is never served by next start or deployed production.
  if (phase !== PHASE_DEVELOPMENT_SERVER && phase !== PHASE_PRODUCTION_BUILD) {
    throw new Error("The isolated creator preview cannot run as a production server");
  }
  return {
    distDir: phase === PHASE_PRODUCTION_BUILD ? ".local-preview/build" : ".local-preview/next",
  };
}
