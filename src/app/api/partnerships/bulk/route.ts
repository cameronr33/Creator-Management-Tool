import { NextResponse, after, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships, cmStageTransitions } from "@/lib/db/schema";
import { refreshFromInstagram } from "@/lib/instagram";
import { approve, undoApproval } from "@/lib/approvals";
import { undoMove } from "@/lib/email-status";
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
import { moveToCampaign, removePartnerships, restoreCampaigns } from "@/lib/campaigns";
import { STAGE_VALUES } from "@/lib/stages";
import { memberForUser, restoreOwners, setOwner, takeUnassigned } from "@/lib/owners";
import { restoreArchived, setArchived } from "@/lib/archive";
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
  // Archive (2026-09-29): off Today, the Pipeline and the Creators list until they write or the stage moves.
  z.object({ action: z.literal("archive"), ids: z.array(z.string()).min(1).max(500), reason: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("unarchive"), ids: z.array(z.string()).min(1).max(500) }),
  // The owner toast's Undo (2026-09-29): back to who owned each before — only where the owner is still `expected`.
  z.object({
    action: z.literal("restore_owner"),
    ids: z.array(z.string()).min(1).max(500),
    prior: z.array(z.object({ id: z.string().uuid(), ownerId: z.string().uuid().nullable() })).min(1).max(500),
    expected: z.string().uuid().nullable(),
  }),
  // The bulk toasts' Undo (interaction review 2026-09-30): each server-checked, a change made since stands.
  z.object({ action: z.literal("undo_moves"), ids: z.array(z.string()).min(1).max(500), transitionIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({
    action: z.literal("restore_campaign"),
    ids: z.array(z.string()).min(1).max(500),
    prior: z.array(z.object({ id: z.string().uuid(), campaignId: z.string().uuid() })).min(1).max(500),
    movedTo: z.string().uuid(),
  }),
  z.object({ action: z.literal("undo_approve"), ids: z.array(z.string()).min(1).max(500), decidedAt: z.string().max(40) }),
]);

/**
 * A bulk Undo's answer: nothing undone is an error (they changed since, or ten
 * minutes passed), a partial one says how many (review 2026-09-30).
 */
function undoAnswer(done: number, of: number, verb: string) {
  if (!done) return badRequest("Nothing could be undone — they've changed since, or it's been more than ten minutes.");
  return NextResponse.json({ ok: true, done, message: done < of ? `${done} of ${of} ${verb} — the rest changed since` : `${done} ${verb}` });
}

/**
 * POST /api/partnerships/bulk — the Creators table's bulk bar (and a single
 * row's "Move to campaign"). Every id must belong to the selected client.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Couldn't save that. Reload the page and try again.", parsed.error.flatten());
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
  if (d.action === "archive") {
    const archived = await setArchived([...new Set(d.ids)], { until: null, reason: d.reason ?? null, byName: session.user.name ?? session.user.email ?? null });
    return NextResponse.json({ ok: true, archived });
  }
  if (d.action === "unarchive") {
    const restored = await restoreArchived([...new Set(d.ids)]);
    return NextResponse.json({ ok: true, restored });
  }
  if (d.action === "undo_moves") {
    const own = new Set(d.ids);
    const moves = await db.select({ id: cmStageTransitions.id, partnershipId: cmStageTransitions.partnershipId }).from(cmStageTransitions).where(inArray(cmStageTransitions.id, d.transitionIds));
    let undone = 0;
    for (const m of moves) if (own.has(m.partnershipId) && (await undoMove(m.id, session.user.id)).ok) undone++;
    return undoAnswer(undone, d.transitionIds.length, "undone");
  }
  if (d.action === "restore_campaign") {
    const own = new Set(d.ids);
    const prior = d.prior.filter((p) => own.has(p.id));
    // Only back into this client's campaigns.
    for (const c of new Set([d.movedTo, ...prior.map((p) => p.campaignId)])) {
      const bad = await assertCampaignInSelectedClient(c);
      if (bad) return bad;
    }
    const r = await restoreCampaigns(prior, d.movedTo);
    return undoAnswer(r.restored, prior.length, "moved back");
  }
  if (d.action === "undo_approve") {
    const client = await resolveClient(await getSelectedClientSlug());
    if (!client) return badRequest("Pick a client in the sidebar first.");
    const by = { name: session.user.name ?? "A teammate", kind: "agency" as const, userId: session.user.id };
    const r = await undoApproval(client.id, d.ids, by, d.decidedAt);
    return undoAnswer(r.undone, d.ids.length, "undone");
  }
  if (d.action === "restore_owner") {
    // Only the deals this request was checked for.
    const allowed = new Set(d.ids);
    if (!d.prior.every((p) => allowed.has(p.id))) return badRequest("That can't be undone from here any more. Reload the page.");
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
  const transitionIds: string[] = [];
  for (const id of [...new Set(d.ids)]) {
    const r = await changeStage(id, d.stage, session.user.id, { exitReason: d.exitReason });
    if (r.status === "moved") {
      moved++;
      transitionIds.push(r.transitionId);
    } else if (r.status === "needs_video") needVideo++;
    else unchanged++;
  }
  return NextResponse.json({ ok: true, moved, unchanged, needVideo, transitionIds });
}
