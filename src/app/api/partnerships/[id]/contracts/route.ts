import { NextResponse, after, type NextRequest } from "next/server";
import { requireAgency, badRequest, assertPartnershipInSelectedClient } from "@/lib/api-helpers";
import { MAX_CONTRACT_BYTES, readContract, storeUpload } from "@/lib/contracts";

/**
 * POST /api/partnerships/[id]/contracts — multipart: file (a PDF, ≤ 10 MB).
 * Keeps it on the deal, then reads it in the background: blank deal fields
 * (fee, terms, product, address) are filled from it. Agency only.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAgency();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertPartnershipInSelectedClient(id);
  if (scope) return scope;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("Choose a PDF first");
  if (file.size > MAX_CONTRACT_BYTES) return badRequest("That file is over 10 MB");
  const stored = await storeUpload(id, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, session.user.id);
  if (!stored.ok) return badRequest(stored.error);
  if (!stored.duplicate) after(() => readContract(stored.id).then(() => undefined));
  return NextResponse.json({ ok: true, id: stored.id, duplicate: stored.duplicate });
}
