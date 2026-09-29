import { NextResponse, after, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships } from "@/lib/db/schema";
import { refreshFromInstagram } from "@/lib/instagram";
import { approve } from "@/lib/approvals";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { z } from "zod";
import {
  requireAgency,
  badRequest,
  assertPartnershipsInSelectedClient,
  assertCampaignInSelectedClient,
} from "@/lib/api-helpers";
import { changeStage } from "@/lib/mutations";
import { moveToCampaign, removePartnerships } from "@/lib/campaigns";
import { STAGE_VALUES } from "@/lib/stages";
import { memberForUser, restoreOwners, setOwner, takeUnassigned } from "@/lib/owners";
import { cmExitReasonEnum } from "@/lib/db/schema";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids: z.array(z.string()).min(1).max(500) }),
  z.object({
    action: z.literal("set_stage"),
    ids: z.array(z.string()).min(1).max(500),
    stage: z.enum(STAGE_VALUES),
    exitReason: z.enum(cmExitReasonEnum.enumValues).nullable().optional(),
  }),
  z.object({ action: z.literal("set_campaign"), ids: z.array(z.string()).min(1).max(500), campaignId: z.string() }),
  z.object({ action: z.literal("refresh_instagram"), ids: z.array(z.string()).min(1).max(500) }),
  z.object({ action: z.literal("approve"), ids: z.array(z.string()).min(1).max(500) }),
  // Owners (2026-09-28): assign to a teammate (null = nobody), or take unassigned ones yourself.
  z.object({ action: z.literal("set_owner"), ids: z.array(z.string()).min(1).max(500), ownerId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("take"), ids: z.array(z.string()).min(1).max(500) }),
  // The owner toast's Undo (2026-09-29): back to who owned each before — only where the owner is still `expected`.
  z.object({
    action: z.literal("restore_owner"),
    ids: z.array(z.string()).min(1).max(500),
    prior: z.array(z.object({ id: z.string().uuid(), ownerId: z.string().uuid().nullable() })).min(1).max(500),
    expected: z.string().uuid().nullable(),
  }),
]);

/**
 * POST /api/partnerships/bulk — the Creators table's bulk bar (and a single
 * row's "Move to campaign"). Every id must belong to the selected client.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid bulk action", parsed.error.flatten());
  const d = parsed.data;
  const scope = await assertPartnershipsInSelectedClient(d.ids);
  if (scope) return scope;

  if (d.action === "delete") {
    const r = await removePartnerships(d.ids);
    return NextResponse.json({ ok: true, ...r });
  }
  if (d.action === "approve") {
    // Approving for outreach on the client's behalf, under the teammate's name.
    const client = await resolveClient(await getSelectedClientSlug());
    if (!client) return badRequest("Pick a client in the sidebar first");
    const r = await approve(client.id, d.ids, { name: session.user.name ?? "A teammate", kind: "agency", userId: session.user.id });
    return NextResponse.json({ ok: true, ...r });
  }
  if (d.action === "refresh_instagram") {
    // A lookup takes up to a couple of minutes per 25 creators: answer now, fetch after.
    const rows = await db.selectDistinct({ creatorId: cmPartnerships.creatorId }).from(cmPartnerships).where(inArray(cmPartnerships.id, d.ids));
    after(() => refreshFromInstagram(rows.map((r) => r.creatorId)).then((r) => console.log("[instagram] bulk refresh", r)));
    return NextResponse.json({ ok: true, queued: rows.length });
  }
  if (d.action === "set_owner") {
    const r = await setOwner([...new Set(d.ids)], d.ownerId);
    if (!r.ok) return badRequest(r.error);
    return NextResponse.json({ ok: true, updated: r.updated, prior: r.prior });
  }
  if (d.action === "take") {
    const me = await memberForUser(session.user);
    if (!me) return badRequest("You're not on the team list — add yourself under Settings → Team");
    const r = await takeUnassigned([...new Set(d.ids)], me.id);
    return NextResponse.json({ ok: true, ...r });
  }
  if (d.action === "restore_owner") {
    // Only the deals this request was checked for.
    const allowed = new Set(d.ids);
    if (!d.prior.every((p) => allowed.has(p.id))) return badRequest("Invalid undo");
    const r = await restoreOwners(d.prior, d.expected);
    return NextResponse.json({ ok: true, ...r });
  }
  if (d.action === "set_campaign") {
    const c = await assertCampaignInSelectedClient(d.campaignId);
    if (c) return c;
    const r = await moveToCampaign(d.ids, d.campaignId);
    return NextResponse.json({ ok: true, ...r });
  }
  // set_stage: each goes through the stage-move core (shipment / video guards, transition rows).
  let moved = 0;
  let unchanged = 0;
  let needVideo = 0;
  for (const id of [...new Set(d.ids)]) {
    const r = await changeStage(id, d.stage, session.user.id, { exitReason: d.exitReason });
    if (r.status === "moved") moved++;
    else if (r.status === "needs_video") needVideo++;
    else unchanged++;
  }
  return NextResponse.json({ ok: true, moved, unchanged, needVideo });
}
