import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clients,
  cmCampaigns,
  cmCreatorPhotos,
  cmCreators,
  cmDeliverables,
  cmPartnerships,
  cmProductsRequested,
  cmShipments,
  type CmStage,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { canonicalStage } from "@/lib/stages";
import { formatAddress } from "@/lib/address";
import { activeClientPerson } from "@/lib/client-session";

/**
 * What the client portal may show — and nothing else. Every column is picked
 * by name: no email text or summaries, no fees or agreed terms, no internal
 * notes, no other client. The shipping address appears only while the
 * product is theirs to send (Ready to ship). verify-portal asserts the exact
 * key sets below, so adding a field is a deliberate decision.
 *
 * Views (owner, 2026-09-28): each video's count goes out labelled verified
 * (read from Instagram's public count) or estimated — anything else, a
 * missing source included, is estimated. The two are never added together
 * (frozen node 1; portal-export.ts keeps the totals apart).
 */

export const PORTAL_CREATOR_KEYS = [
  "partnershipId",
  "creatorId",
  "name",
  "handle",
  "profileUrl",
  "followers",
  "contentType",
  "campaignName",
  "stage",
  "clientApproval",
  "photoUrl",
  "shipment",
  "shipTo",
  "shipToParts",
  "products",
  "videos",
] as const;

/** A video as the portal shows it — verify-portal asserts exactly these keys. */
export const PORTAL_VIDEO_KEYS = ["url", "postedAt", "views", "viewsKind"] as const;

export type ViewsKind = "verified" | "estimated";

/** Pure: how a view count may be described to the client. Only Instagram's public count is verified. */
export function viewsKindOf(views: number | null, metricsSource: string | null): ViewsKind | null {
  if (views == null) return null;
  return metricsSource === "ig_public_chrome" ? "verified" : "estimated";
}

/** The address in parts, for the shipping list (same rule as shipTo: Ready to ship only). */
export interface ShipToParts {
  recipient: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface PortalCreator {
  partnershipId: string;
  creatorId: string;
  name: string;
  handle: string | null;
  profileUrl: string | null;
  followers: number | null;
  contentType: string | null;
  campaignName: string;
  stage: CmStage;
  clientApproval: "pending" | "approved" | "passed" | null;
  photoUrl: string | null;
  shipment: { id: string; status: string; carrier: string | null; trackingNumber: string | null; shippedAt: string | null; deliveredAt: string | null } | null;
  /** Only while it's theirs to ship (Ready to ship). */
  shipTo: string | null;
  shipToParts: ShipToParts | null;
  products: string[];
  videos: { url: string; postedAt: string | null; views: number | null; viewsKind: ViewsKind | null }[];
}

export interface PortalContext {
  clientId: string;
  clientName: string;
  /** The agency looking at what the client sees: shown, nothing saved. */
  readOnly: boolean;
  viewerName: string;
}

/** Who is looking and at which brand: a client login's own, or the agency's selected client (read-only). */
export async function getPortalContext(): Promise<PortalContext | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.kind === "client") {
    // Re-checked every time: a login turned off, removed or re-invited ends at once.
    const person = await activeClientPerson(session);
    if (!person) return null;
    const [c] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, person.clientId)).limit(1);
    return c ? { clientId: c.id, clientName: c.name, readOnly: false, viewerName: person.name } : null;
  }
  const c = await resolveClient(await getSelectedClientSlug());
  return c ? { clientId: c.id, clientName: c.name, readOnly: true, viewerName: session.user.name ?? "" } : null;
}

export async function getPortalCreators(clientId: string): Promise<PortalCreator[]> {
  const rows = await db
    .select({
      partnershipId: cmPartnerships.id,
      creatorId: cmCreators.id,
      name: cmCreators.name,
      username: cmCreators.username,
      profileUrl: cmCreators.profileUrl,
      followers: cmCreators.followers,
      contentType: cmCreators.contentPillar,
      campaignName: cmCampaigns.name,
      stage: cmPartnerships.stage,
      clientApproval: cmPartnerships.clientApproval,
      recipientName: cmPartnerships.recipientName,
      addressLine1: cmPartnerships.addressLine1,
      addressLine2: cmPartnerships.addressLine2,
      city: cmPartnerships.city,
      region: cmPartnerships.region,
      postalCode: cmPartnerships.postalCode,
      country: cmPartnerships.country,
      photoAt: cmCreatorPhotos.fetchedAt,
    })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .innerJoin(cmCampaigns, eq(cmCampaigns.id, cmPartnerships.campaignId))
    .leftJoin(cmCreatorPhotos, eq(cmCreatorPhotos.creatorId, cmCreators.id))
    .where(eq(cmCreators.clientId, clientId))
    .orderBy(desc(cmCreators.followers));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.partnershipId);
  const [shipments, products, videos] = await Promise.all([
    db
      .select({
        id: cmShipments.id,
        partnershipId: cmShipments.partnershipId,
        status: cmShipments.status,
        carrier: cmShipments.carrier,
        trackingNumber: cmShipments.trackingNumber,
        shippedAt: cmShipments.shippedAt,
        deliveredAt: cmShipments.deliveredAt,
      })
      .from(cmShipments)
      .where(inArray(cmShipments.partnershipId, ids))
      .orderBy(desc(cmShipments.createdAt)),
    db.select({ partnershipId: cmProductsRequested.partnershipId, name: cmProductsRequested.productName, quantity: cmProductsRequested.quantity }).from(cmProductsRequested).where(inArray(cmProductsRequested.partnershipId, ids)),
    db
      .select({ partnershipId: cmDeliverables.partnershipId, url: cmDeliverables.url, postedAt: cmDeliverables.postedAt, views: cmDeliverables.views, metricsSource: cmDeliverables.metricsSource })
      .from(cmDeliverables)
      .where(and(inArray(cmDeliverables.partnershipId, ids))),
  ]);
  return rows.map((r): PortalCreator => {
    const stage = canonicalStage(r.stage);
    const s = shipments.find((x) => x.partnershipId === r.partnershipId);
    return {
      partnershipId: r.partnershipId,
      creatorId: r.creatorId,
      name: r.name,
      handle: r.profileUrl ? r.username : null,
      profileUrl: r.profileUrl || null,
      followers: r.followers,
      contentType: r.contentType,
      campaignName: r.campaignName,
      stage,
      clientApproval: r.clientApproval,
      photoUrl: r.photoAt ? `/api/creators/${r.creatorId}/photo?v=${r.photoAt.getTime()}` : null,
      shipment: s
        ? { id: s.id, status: s.status, carrier: s.carrier, trackingNumber: s.trackingNumber, shippedAt: s.shippedAt?.toISOString() ?? null, deliveredAt: s.deliveredAt?.toISOString() ?? null }
        : null,
      shipTo: stage === "fulfilling" ? formatAddress(r) || null : null,
      shipToParts:
        stage === "fulfilling" && formatAddress(r)
          ? { recipient: r.recipientName, line1: r.addressLine1, line2: r.addressLine2, city: r.city, region: r.region, postalCode: r.postalCode, country: r.country }
          : null,
      products: products.filter((p) => p.partnershipId === r.partnershipId).map((p) => (p.quantity > 1 ? `${p.quantity} × ${p.name}` : p.name)),
      videos: videos
        .filter((v) => v.partnershipId === r.partnershipId)
        .map((v) => ({ url: v.url, postedAt: v.postedAt?.toISOString() ?? null, views: v.views, viewsKind: viewsKindOf(v.views, v.metricsSource) })),
    };
  });
}

/** Is this partnership one of this client's? (The portal's endpoints check before acting.) */
export async function partnershipOfClient(clientId: string, partnershipId: string): Promise<{ stage: CmStage; shipmentId: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(partnershipId)) return null;
  const [r] = await db
    .select({ stage: cmPartnerships.stage })
    .from(cmPartnerships)
    .innerJoin(cmCreators, eq(cmCreators.id, cmPartnerships.creatorId))
    .where(and(eq(cmPartnerships.id, partnershipId), eq(cmCreators.clientId, clientId)))
    .limit(1);
  if (!r) return null;
  const [s] = await db.select({ id: cmShipments.id }).from(cmShipments).where(eq(cmShipments.partnershipId, partnershipId)).orderBy(desc(cmShipments.createdAt)).limit(1);
  return { stage: canonicalStage(r.stage), shipmentId: s?.id ?? null };
}
