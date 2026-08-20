/**
 * Fill a LOCAL database with representative demo data so every page has
 * something to render. Refuses to run against Neon — this writes junk rows and
 * must never touch a real client's data.
 *
 *   npm run db:seed-demo
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

if (/neon\.tech/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run against a Neon database. Point DATABASE_URL at a local Postgres.");
  process.exit(1);
}

const {
  clients,
  cmCampaigns,
  cmCreators,
  cmCreatorSocials,
  cmCreatorReels,
  cmPartnerships,
  cmOutreachEvents,
  cmProductsRequested,
  cmShipments,
  cmDeliverables,
  cmAlerts,
  cmMessageTemplates,
} = schema;

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);
const isoDate = (d: number) => ago(d).toISOString().slice(0, 10);

const TEMPLATE = `Hey {{name}}, Kieran from HELLA!

Been enjoying your {{content_descriptor}} for a while. {{reason}}.

We're building out our creator roster this year and you were high on the list.

Set up's pretty simple. We'll hook you up with free product you like, and you can make content about it in your own style/voice. Is this something you'd be interested in?`;

type Seed = {
  name: string;
  username: string;
  pillar: string;
  followers: number;
  avg: number;
  median: number;
  max: number;
  cadence: string;
  stage: (typeof schema.cmStageEnum.enumValues)[number];
  email?: string;
  summary: string;
  agreement?: (typeof schema.cmAgreementTypeEnum.enumValues)[number];
  exit?: (typeof schema.cmExitReasonEnum.enumValues)[number];
  city?: string;
  region?: string;
};

const HELLA_CREATORS: Seed[] = [
  {
    name: "Marcus Webb", username: "overland.marcus", pillar: "Overlanding builds",
    followers: 184_000, avg: 412_000, median: 288_000, max: 2_100_000, cadence: "3.50",
    stage: "posted", email: "marcus@overlandmedia.co", agreement: "signed",
    city: "Bend", region: "OR",
    summary: "Long-form 4Runner and Tacoma build breakdowns, heavy on lighting and recovery gear. Sponsored integrations read as genuine product use rather than reads.",
  },
  {
    name: "Priya Raghunathan", username: "priyabuildsrigs", pillar: "Off-road fabrication",
    followers: 96_400, avg: 218_000, median: 165_000, max: 890_000, cadence: "2.75",
    stage: "fulfilling", email: "hello@priyabuilds.com", agreement: "verbal",
    city: "Flagstaff", region: "AZ",
    summary: "Fabrication-forward content: bumper builds, wiring harnesses, light bar mounting. Audience skews technical and asks part-number questions in comments.",
  },
  {
    name: "Danny Okafor", username: "nightshiftgarage", pillar: "Night driving / lighting",
    followers: 341_000, avg: 705_000, median: 520_000, max: 4_400_000, cadence: "4.25",
    stage: "negotiating", email: "booking@nightshiftgarage.tv",
    summary: "Night-run POV footage and lighting comparisons shot on rural roads. The highest-reach account on the list and the most explicitly lighting-focused.",
  },
  {
    name: "Sam Ellery", username: "sam.drives.slow", pillar: "Vintage restoration",
    followers: 52_100, avg: 88_000, median: 61_000, max: 340_000, cadence: "1.50",
    stage: "content_pending", agreement: "verbal", city: "Asheville", region: "NC",
    summary: "Slow-paced restoration diaries on air-cooled VWs and early Broncos. Lower reach but unusually high save rate and a comment section full of build questions.",
  },
  {
    name: "Tori Nakashima", username: "torinakaoffroad", pillar: "Trail riding",
    followers: 128_000, avg: 265_000, median: 194_000, max: 1_300_000, cadence: "3.00",
    stage: "awaiting_address", email: "tori@tnkcreative.com", agreement: "signed",
    summary: "Trail-run edits from the Pacific Northwest with a recurring recovery-gear segment. Consistent poster, rarely misses a week.",
  },
  {
    name: "Elliot Vance", username: "vancewrenching", pillar: "DIY repair",
    followers: 74_800, avg: 132_000, median: 97_000, max: 610_000, cadence: "2.25",
    stage: "in_conversation",
    summary: "Tutorial-first repair content aimed at first-time wrenchers. Explains part selection on camera, which fits an educational brand integration well.",
  },
  {
    name: "Casey Lindqvist", username: "caseyonthetrail", pillar: "Adventure travel",
    followers: 210_000, avg: 340_000, median: 245_000, max: 1_050_000, cadence: "2.00",
    stage: "contacted",
    summary: "Travel-led rather than build-led — the vehicle is the vessel, not the subject. Broad reach but softer product relevance than the fabrication accounts.",
  },
  {
    name: "Rashida Bell", username: "rashidabuilds", pillar: "Truck builds",
    followers: 63_200, avg: 104_000, median: 78_000, max: 420_000, cadence: "1.75",
    stage: "shortlisted",
    summary: "Half-ton truck builds with an emphasis on towing and work use. Practical, unflashy content with a loyal repeat audience.",
  },
  {
    name: "Jonah Pryce", username: "pryce.of.speed", pillar: "Motorsport",
    followers: 425_000, avg: 890_000, median: 640_000, max: 5_200_000, cadence: "5.00",
    stage: "declined", exit: "wants_more_money", email: "mgmt@pryceofspeed.com",
    summary: "Track-day and time-attack coverage with the largest following on the shortlist. Asked for a flat fee well above the campaign budget.",
  },
  {
    name: "Wren Adeyemi", username: "wrenadeyemi", pillar: "Van life",
    followers: 88_500, avg: 156_000, median: 118_000, max: 520_000, cadence: "2.50",
    stage: "no_response", exit: "went_dark",
    summary: "Van conversion and off-grid power content. Replied warmly to the first message, then stopped responding after the spec sheet went over.",
  },
  {
    name: "Felix Moreau", username: "moreaumotors", pillar: "European tuning",
    followers: 31_700, avg: 44_000, median: 33_000, max: 145_000, cadence: "0.75",
    stage: "passed", exit: "below_cadence",
    summary: "Well-shot European tuning content, but posts under once a week and view counts have trended down over the last two quarters.",
  },
  {
    name: "Ana Sotelo", username: "anasoteloadv", pillar: "Desert running",
    followers: 156_000, avg: 298_000, median: 210_000, max: 1_600_000, cadence: "3.25",
    stage: "completed", email: "ana@sotelocreative.com", agreement: "signed",
    city: "Tucson", region: "AZ",
    summary: "Desert and Baja-style running footage, frequently shot at dusk. Delivered two posts against a one-post agreement on the last campaign.",
  },
];

const MEYLE_CREATORS: Seed[] = [
  {
    name: "Ingrid Halvorsen", username: "ingridwrenches", pillar: "Suspension work",
    followers: 71_300, avg: 118_000, median: 86_000, max: 390_000, cadence: "2.00",
    stage: "researched",
    summary: "Control-arm and bushing replacement walkthroughs on European chassis. Directly adjacent to the parts catalogue.",
  },
  {
    name: "Theo Brandt", username: "brandtgarage", pillar: "Daily driver maintenance",
    followers: 45_900, avg: 72_000, median: 55_000, max: 240_000, cadence: "1.25",
    stage: "agreed", agreement: "verbal",
    summary: "Maintenance-interval content for high-mileage daily drivers. Small but highly engaged audience that asks about part quality specifically.",
  },
];

async function upsertClient(name: string, slug: string) {
  const existing = await db.select().from(clients).where(eq(clients.slug, slug)).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(clients).values({ name, slug }).returning();
  return row;
}

async function seedCreator(clientId: string, campaignId: string, s: Seed, i: number) {
  const [creator] = await db
    .insert(cmCreators)
    .values({
      clientId,
      name: s.name,
      username: s.username,
      profileUrl: `https://www.instagram.com/${s.username}/`,
      platform: "instagram",
      businessEmail: s.email ?? null,
      contentPillar: s.pillar,
      followers: s.followers,
      reelsPulled: 12,
      cadencePerWeek: s.cadence,
      dateRangeStart: isoDate(90),
      dateRangeEnd: isoDate(1),
      avgViews: s.avg,
      medianViews: s.median,
      maxViews: s.max,
      viewsSource: "ig_public_chrome",
      contentTypeSummary: s.summary,
      researchedAt: ago(30 + i),
      lastRefreshedAt: ago(7 + i),
    })
    .returning();

  await db.insert(cmCreatorSocials).values({
    creatorId: creator.id,
    platform: "instagram",
    url: creator.profileUrl,
    handle: s.username,
    isPrimary: true,
  });

  await db.insert(cmCreatorReels).values(
    [0, 1, 2].map((n) => ({
      creatorId: creator.id,
      rank: n + 1,
      shortcode: `C${s.username.slice(0, 4)}${n}`,
      url: `https://www.instagram.com/reel/C${s.username.slice(0, 4)}${n}/`,
      views: Math.round(s.max / (n + 1)),
      description: [
        "Night run through switchbacks, light bar sweep across the treeline at 0:04.",
        "Bumper mock-up to final weld, time-lapsed, wiring routed on camera.",
        "Recovery sequence in mud — winch line, spotter, and a clean extraction.",
      ][n],
    })),
  );

  const [p] = await db
    .insert(cmPartnerships)
    .values({
      creatorId: creator.id,
      campaignId,
      stage: s.stage,
      agreementType: s.agreement ?? null,
      compensationType: "free_product",
      exitReason: s.exit ?? null,
      recipientName: s.city ? s.name : null,
      addressLine1: s.city ? `${100 + i} Ridgeline Rd` : null,
      city: s.city ?? null,
      region: s.region ?? null,
      postalCode: s.city ? String(97000 + i * 7) : null,
      country: "US",
      briefSentAt: ["content_pending", "posted", "completed"].includes(s.stage) ? ago(14) : null,
    })
    .returning();

  const contacted = !["researched", "shortlisted"].includes(s.stage);
  if (contacted) {
    await db.insert(cmOutreachEvents).values({
      partnershipId: p.id,
      occurredAt: ago(25 - i),
      direction: "outbound",
      channel: "ig_dm",
      kind: "initial",
      body: TEMPLATE.replace("{{name}}", s.name.split(" ")[0]),
    });
  }
  if (["no_response", "contacted"].includes(s.stage)) {
    await db.insert(cmOutreachEvents).values({
      partnershipId: p.id,
      occurredAt: ago(12 - i / 2),
      direction: "outbound",
      channel: "ig_dm",
      kind: "follow_up",
      body: "Hey — just floating this back up in case it got buried!",
    });
    await db.insert(cmAlerts).values({
      partnershipId: p.id,
      type: s.stage === "no_response" ? "follow_up_2_due" : "follow_up_1_due",
      dueAt: ago(2),
      status: "open",
    });
  }
  if (["in_conversation", "negotiating", "agreed", "awaiting_address", "fulfilling", "content_pending", "posted", "completed"].includes(s.stage)) {
    await db.insert(cmOutreachEvents).values({
      partnershipId: p.id,
      occurredAt: ago(20 - i),
      direction: "inbound",
      channel: "ig_dm",
      kind: "reply",
      body: "Yes! Big fan of the brand — send over what you had in mind.",
    });
  }

  if (["agreed", "awaiting_address", "fulfilling", "content_pending", "posted", "completed"].includes(s.stage)) {
    await db.insert(cmProductsRequested).values([
      { partnershipId: p.id, productName: "Value Fit LED Light Bar 20\"", category: "Lighting", quantity: 1 },
      { partnershipId: p.id, productName: "500 Series Driving Lamp Kit", category: "Lighting", quantity: 2 },
    ]);
  }

  if (["fulfilling", "content_pending", "posted", "completed"].includes(s.stage)) {
    await db.insert(cmShipments).values({
      partnershipId: p.id,
      status: s.stage === "fulfilling" ? "shipped" : "delivered",
      carrier: "UPS",
      trackingNumber: `1Z999AA1${String(10000000 + i * 137).slice(0, 8)}`,
      shippedAt: ago(12),
      deliveredAt: s.stage === "fulfilling" ? null : ago(8),
    });
  }

  if (["posted", "completed"].includes(s.stage)) {
    await db.insert(cmDeliverables).values({
      partnershipId: p.id,
      platform: "instagram",
      url: `https://www.instagram.com/reel/CDEL${s.username.slice(0, 4)}/`,
      shortcode: `CDEL${s.username.slice(0, 4)}`,
      postedAt: ago(5),
      caption: "Ran these through a full night of washboard and they didn't blink. Link in bio.",
      views: Math.round(s.avg * 1.4),
      likes: Math.round(s.avg * 0.06),
      comments: Math.round(s.avg * 0.004),
      metricsSource: "ig_public_chrome",
      metricsRefreshedAt: ago(1),
    });
  }
}

async function main() {
  const hella = await upsertClient("HELLA", "hella");
  const meyle = await upsertClient("MEYLE", "meyle");

  const [hellaCampaign] = await db
    .insert(cmCampaigns)
    .values({ clientId: hella.id, name: "Q3 Lighting Push", description: "Off-road and overlanding creators for the light bar launch." })
    .returning();
  const [meyleCampaign] = await db
    .insert(cmCampaigns)
    .values({ clientId: meyle.id, name: "Suspension Awareness", description: "DIY repair creators for control arms and bushings." })
    .returning();

  await db.insert(cmMessageTemplates).values({
    clientId: hella.id,
    name: "Default IG DM",
    channel: "ig_dm",
    body: TEMPLATE,
    isDefault: true,
  });

  for (const [i, s] of HELLA_CREATORS.entries()) await seedCreator(hella.id, hellaCampaign.id, s, i);
  for (const [i, s] of MEYLE_CREATORS.entries()) await seedCreator(meyle.id, meyleCampaign.id, s, i);

  console.log(`Seeded ${HELLA_CREATORS.length + MEYLE_CREATORS.length} creators across 2 clients.`);
}

main().then(() => process.exit(0));
