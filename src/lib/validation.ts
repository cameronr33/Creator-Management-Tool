import { z } from "zod";

/**
 * Shared zod refinements for API input. Every route that takes a date, URL,
 * money amount or id uses these so a bad value is a clean 400, not a Postgres
 * error surfacing as a 500.
 */

/** A string Date.parse understands (ISO recommended). */
export const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** http(s) only — z.string().url() alone accepts javascript: and data: schemes. */
export const httpUrl = z
  .string()
  .trim()
  .refine(
    (u) => {
      try {
        const p = new URL(u).protocol;
        return p === "http:" || p === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an http(s) URL" },
  );

export const uuid = z.string().uuid();

/** Accepts 1500, "1500", "1,500.00" → 1500 (non-negative). */
export const money = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).replace(/[,$\s]/g, ""))))
  .refine((n) => Number.isFinite(n) && n >= 0, { message: "must be a non-negative amount" });
