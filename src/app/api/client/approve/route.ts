import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireClientUser, badRequest } from "@/lib/api-helpers";
import { approve, pass } from "@/lib/approvals";

/**
 * POST /api/client/approve { partnershipId, decision: "approve"|"pass", note? }
 * — a person at the client decides on a creator waiting for them. Only their
 * own brand's (from the login), only what's waiting.
 */
export async function POST(req: NextRequest) {
  const { person, error } = await requireClientUser();
  if (error) return error;
  const parsed = z
    .object({ partnershipId: z.string().uuid(), decision: z.enum(["approve", "pass"]), note: z.string().max(500).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Choose approve or pass");
  const by = { name: person.name, kind: "client" as const, clientUserId: person.id };
  if (parsed.data.decision === "approve") {
    const r = await approve(person.clientId, [parsed.data.partnershipId], by, parsed.data.note);
    return r.approved ? NextResponse.json({ ok: true }) : badRequest("That creator isn't waiting for your approval");
  }
  const r = await pass(person.clientId, parsed.data.partnershipId, by, parsed.data.note);
  return r.ok ? NextResponse.json({ ok: true }) : badRequest("That creator isn't waiting for your approval");
}
