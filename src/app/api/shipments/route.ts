import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { isoDate } from "@/lib/validation";
import { cmShipmentStatusEnum } from "@/lib/db/schema";
import { recordShipment } from "@/lib/shipments";

const schema = z.object({
  id: z.string().uuid().optional(),
  partnershipId: z.string().uuid(),
  status: z.enum(cmShipmentStatusEnum.enumValues),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  shippedAt: isoDate.nullable().optional(),
  deliveredAt: isoDate.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Couldn't save the shipment. Check the tracking details and try again.", parsed.error.flatten());
  const d = parsed.data;

  const scope = await assertPartnershipInSelectedClient(d.partnershipId);
  if (scope) return scope;

  const r = await recordShipment(d, { kind: "agency", userId: session.user.id });
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, stageChanged: r.stageChanged, undo: r.undo });
}
