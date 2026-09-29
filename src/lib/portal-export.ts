import type { PortalCreator } from "@/lib/portal-data";

/**
 * The portal's shipping list and view totals (owner, 2026-09-28: "portal
 * shipping list + views"). Pure, and built only from what the portal already
 * shows (PortalCreator), so it can't carry anything the portal may not.
 * Tested in scripts/verify-portal.ts.
 */

export const SHIPPING_LIST_HEADER = ["Creator", "Instagram", "Campaign", "Recipient", "Address 1", "Address 2", "City", "State", "ZIP", "Country", "Products"] as const;

/**
 * A spreadsheet cell. Names and addresses can come from a creator's email, so
 * nothing in one may run as a formula: every cell is one line (tabs and line
 * breaks become spaces, so nothing starts a new cell), and = + - @ at the
 * start — or after a ";", the separator in many European settings — is
 * prefixed with ' and shown as text.
 */
export function csvCell(value: string | null | undefined): string {
  const v = (value ?? "").replace(/[\t\r\n]+/g, " ").replace(/(^|;)(\s*)([=+\-@])/g, "$1$2'$3");
  return `"${v.replace(/"/g, '""')}"`;
}

/** Ready-to-ship creators with a confirmed address, one row each — opens straight in Excel or Sheets. */
export function shippingListCsv(creators: PortalCreator[]): string {
  const rows = creators
    .filter((c) => c.stage === "fulfilling" && c.shipToParts)
    .map((c) => {
      const a = c.shipToParts!;
      // The bare handle: an "@" would trip the formula guard and show as '@name.
      return [c.name, c.handle ?? "", c.campaignName, a.recipient, a.line1, a.line2, a.city, a.region, a.postalCode, a.country, c.products.join("; ")];
    });
  // A byte-order mark so Excel reads it as UTF-8 (accents, emoji in names); CRLF line ends.
  return "﻿" + [SHIPPING_LIST_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export interface PortalViewTotals {
  verified: number;
  verifiedVideos: number;
  estimated: number;
  estimatedVideos: number;
}

/**
 * Views, kept apart: verified (read from Instagram's public count) and
 * estimated. The two are never added together (frozen node 1, owner decision
 * of 2026-09-28).
 */
export function portalViewTotals(creators: PortalCreator[]): PortalViewTotals {
  const t: PortalViewTotals = { verified: 0, verifiedVideos: 0, estimated: 0, estimatedVideos: 0 };
  for (const c of creators) {
    for (const v of c.videos) {
      if (v.views == null || v.viewsKind == null) continue;
      if (v.viewsKind === "verified") {
        t.verified += v.views;
        t.verifiedVideos++;
      } else {
        t.estimated += v.views;
        t.estimatedVideos++;
      }
    }
  }
  return t;
}
