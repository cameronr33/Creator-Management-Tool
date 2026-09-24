import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireClientUser, badRequest } from "@/lib/api-helpers";
import { partnershipOfClient } from "@/lib/portal-data";
import { clientMayShip, recordShipment } from "@/lib/shipments";

/**
 * POST /api/client/ship { partnershipId, status: "shipped"|"delivered", carrier?, trackingNumber? }
 * — the brand sends the product. Only their own creators (from the login),
 * shipped only from Ready to ship, delivered only once shipped. The stage
 * moves through the same rule as when the agency marks it.
 */
export async function POST(req: NextRequest) {
  const { person, error } = await requireClientUser();
  if (error) return error;
  const parsed = z
    .object({
      partnershipId: z.string().uuid(),
      status: z.enum(["shipped", "delivered"]),
      carrier: z.string().trim().max(60).optional(),
      trackingNumber: z.string().trim().max(80).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid shipment");
  const d = parsed.data;
  const p = await partnershipOfClient(person.clientId, d.partnershipId);
  if (!p) return badRequest("That creator isn't one of yours");
  if (!clientMayShip(p.stage, d.status)) return badRequest(d.status === "shipped" ? "That creator isn't ready to ship" : "That shipment isn't on its way yet");
  const r = await recordShipment(
    {
      id: p.shipmentId ?? undefined,
      partnershipId: d.partnershipId,
      status: d.status,
      ...(d.carrier ? { carrier: d.carrier } : {}),
      ...(d.trackingNumber ? { trackingNumber: d.trackingNumber } : {}),
    },
    { kind: "client", id: person.id, name: person.name },
  );
  if (!r.ok) return badRequest(r.error);
  return NextResponse.json({ ok: true, stageChanged: r.stageChanged });
}
