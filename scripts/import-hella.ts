/**
 * One-off migration: HELLA's two Google-Sheet exports -> the cm_* schema.
 *
 *   npm run import:hella -- --dry-run    # print the plan + conflict report, write nothing
 *   npm run import:hella                 # apply
 *
 * All transformation lives in src/lib/hella-import.ts (pure, offline-testable).
 * This file only turns the resulting plan into database rows.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { buildImportPlan, type ImportRecord } from "../src/lib/hella-import";

const DOWNLOADS = "C:/Users/camer/Downloads";
const TRACKER_CSV = resolve(DOWNLOADS, "HELLA Creator Tracker - HELLA Creator Tracker.csv");
const SHIPPING_CSV = resolve(DOWNLOADS, "HELLA Affiliate Shipping Details - Sheet1.csv");

const DRY_RUN = process.argv.includes("--dry-run");
const NOW = new Date();

const OUTREACH_TEMPLATE = `Hey {{name}}, Kieran from HELLA!

Been [watching / following / enjoying] your {{content_descriptor}} for a while. {{reason}}.

We're building out our creator roster this year and you were high on the list.

Set up's pretty simple. We'll hook you up with free product you like, and you can make content about it in your own style/voice. Is this something you'd be interested in?`;

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  const plan = buildImportPlan(
    readFileSync(TRACKER_CSV, "utf8"),
    readFileSync(SHIPPING_CSV, "utf8"),
  );

  log(`Tracker rows: ${plan.trackerCount}`);
  log(`Shipping rows: ${plan.shippingCount}`);

  printReports(plan.stageTally, plan.conflicts, plan.flags);

  if (DRY_RUN) {
    log(`\n=== DRY RUN — no writes ===`);
    log(`Would import ${plan.records.length} creators. Re-run without --dry-run to apply.`);
    return;
  }

  const clientId = await ensureClient("HELLA", "hella");
  const campaignCache = new Map<string, string>();
  let created = 0;

  for (const r of plan.records) {
    const campaignId = await ensureCampaign(clientId, r.campaignName, campaignCache);
    await writeRecord(clientId, campaignId, r);
    created++;
  }

  await ensureTemplate(clientId);

  log(`\nImported ${created} creators into HELLA.`);
}

async function writeRecord(clientId: string, campaignId: string, r: ImportRecord) {
  const [creator] = await db
    .insert(schema.cmCreators)
    .values({
      clientId,
      name: r.name,
      username: r.username,
      profileUrl: r.profileUrl,
      businessEmail: r.businessEmail,
      contentPillar: r.contentPillar,
      followers: r.followers,
      reelsPulled: r.reelsPulled,
      cadencePerWeek: r.cadencePerWeek?.toString() ?? null,
      dateRangeStart: r.dateRangeStart,
      dateRangeEnd: r.dateRangeEnd,
      avgViews: r.avgViews,
      medianViews: r.medianViews,
      maxViews: r.maxViews,
      viewsSource: r.viewsSource,
      contentTypeSummary: r.contentTypeSummary,
      researchedAt: NOW,
      notes: r.creatorNotes,
    })
    .onConflictDoUpdate({
      target: [schema.cmCreators.clientId, schema.cmCreators.username],
      set: { updatedAt: NOW },
    })
    .returning();

  await db.delete(schema.cmCreatorReels).where(eq(schema.cmCreatorReels.creatorId, creator.id));
  for (const reel of r.reels) {
    await db.insert(schema.cmCreatorReels).values({
      creatorId: creator.id,
      rank: reel.rank,
      url: reel.url,
      shortcode: reel.shortcode,
      views: reel.views,
      description: reel.description,
    });
  }

  const [partnership] = await db
    .insert(schema.cmPartnerships)
    .values({
      creatorId: creator.id,
      campaignId,
      stage: r.stage,
      agreementType: r.agreementType,
      compensationType: r.compensationType,
      recipientName: r.address?.recipientName ?? null,
      addressLine1: r.address?.addressLine1 ?? null,
      addressLine2: r.address?.addressLine2 ?? null,
      city: r.address?.city ?? null,
      region: r.address?.region ?? null,
      postalCode: r.address?.postalCode ?? null,
      country: r.address?.country ?? "US",
      addressRaw: r.addressRaw,
      exitReason: r.exitReason as never,
      notes: r.partnershipNotes,
    })
    .onConflictDoUpdate({
      target: [schema.cmPartnerships.creatorId, schema.cmPartnerships.campaignId],
      set: { stage: r.stage, updatedAt: NOW },
    })
    .returning();

  await db.insert(schema.cmStageTransitions).values({
    partnershipId: partnership.id,
    fromStage: null,
    toStage: r.stage,
  });

  await db.delete(schema.cmProductsRequested).where(eq(schema.cmProductsRequested.partnershipId, partnership.id));
  for (const p of r.products) {
    await db.insert(schema.cmProductsRequested).values({
      partnershipId: partnership.id,
      productName: p.productName,
      productUrl: p.productUrl,
      category: p.category,
      quantity: p.quantity,
      notes: p.notes,
    });
  }

  if (r.needsShipment && r.shipmentStatus) {
    await db.insert(schema.cmShipments).values({
      partnershipId: partnership.id,
      status: r.shipmentStatus,
      shippedAt: r.shipmentStatus === "shipped" ? NOW : null,
    });
  }

  if (r.outreach.length) {
    await db.insert(schema.cmOutreachEvents).values(
      r.outreach.map((o) => ({
        partnershipId: partnership.id,
        occurredAt: NOW,
        direction: o.direction,
        channel: o.channel,
        kind: o.kind,
        body: "migrated from sheet; original date unknown",
        isMigrated: true,
      })),
    );
  }
}

function printReports(
  stageTally: Record<string, number>,
  conflicts: { creator: string; field: string; tracker: string; shipping: string; imported: string; reason: string }[],
  flags: { creator: string; issue: string }[],
) {
  log("\n── Stage tally ──");
  for (const [stage, n] of Object.entries(stageTally).sort((a, b) => b[1] - a[1])) {
    log(`  ${stage.padEnd(18)} ${n}`);
  }
  log(`\n── Conflicts (${conflicts.length}) ──`);
  for (const c of conflicts) {
    log(`  ${c.creator} · ${c.field}`);
    log(`      tracker:  ${c.tracker}`);
    log(`      shipping: ${c.shipping}`);
    log(`      imported: ${c.imported}  (${c.reason})`);
  }
  log(`\n── Flags for manual review (${flags.length}) ──`);
  for (const f of flags) log(`  ${f.creator}: ${f.issue}`);
}

async function ensureClient(name: string, slug: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(eq(schema.clients.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(schema.clients).values({ name, slug }).returning({ id: schema.clients.id });
  return row.id;
}

async function ensureCampaign(clientId: string, name: string, cache: Map<string, string>): Promise<string> {
  const key = `${clientId}:${name.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key)!;
  const [existing] = await db
    .select({ id: schema.cmCampaigns.id })
    .from(schema.cmCampaigns)
    .where(and(eq(schema.cmCampaigns.clientId, clientId), eq(schema.cmCampaigns.name, name)))
    .limit(1);
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const [row] = await db.insert(schema.cmCampaigns).values({ clientId, name }).returning({ id: schema.cmCampaigns.id });
  cache.set(key, row.id);
  return row.id;
}

async function ensureTemplate(clientId: string) {
  const [existing] = await db
    .select({ id: schema.cmMessageTemplates.id })
    .from(schema.cmMessageTemplates)
    .where(and(eq(schema.cmMessageTemplates.clientId, clientId), eq(schema.cmMessageTemplates.isDefault, true)))
    .limit(1);
  if (existing) return;
  await db.insert(schema.cmMessageTemplates).values({
    clientId,
    name: "Kieran — evergreen intro",
    channel: "ig_dm",
    body: OUTREACH_TEMPLATE,
    isDefault: true,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
