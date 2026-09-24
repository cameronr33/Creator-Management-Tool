import { NextResponse, after, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAgency, badRequest, isUuid, notFound } from "@/lib/api-helpers";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { db } from "@/lib/db";
import { cmContracts } from "@/lib/db/schema";
import { contractOfClient, isStaleRead, markForReread, readContract } from "@/lib/contracts";

/**
 * One contract, only within the client selected in the sidebar. Agency only —
 * contracts hold fees and terms, which the client portal never shows.
 *   GET    the PDF itself (opens in the browser)
 *   POST   read it again (or, for an email attachment that couldn't be fetched, fetch it again)
 *   DELETE remove the file (what it already filled in stays)
 */
async function scoped(id: string) {
  if (!isUuid(id)) return { error: badRequest("Invalid contract id") } as const;
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return { error: notFound("No client selected") } as const;
  const contract = await contractOfClient(client.id, id);
  if (!contract) return { error: notFound("Contract not found") } as const;
  return { contract } as const;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const s = await scoped((await ctx.params).id);
  if ("error" in s) return s.error;
  if (!s.contract.data) return notFound("This attachment hasn't been downloaded yet — it will be on the next email check");
  const name = s.contract.filename.replace(/[^\w .()-]+/g, "_");
  return new NextResponse(new Uint8Array(Buffer.from(s.contract.data, "base64")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const s = await scoped((await ctx.params).id);
  if ("error" in s) return s.error;
  if (s.contract.readStatus === "reading" && !isStaleRead(s.contract)) return badRequest("It's being read right now");
  if (!s.contract.data && s.contract.source === "upload") return badRequest("That file wasn't kept — upload it again");
  await markForReread(s.contract.id);
  if (s.contract.data) after(() => readContract(s.contract.id).then(() => undefined));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAgency();
  if (error) return error;
  const s = await scoped((await ctx.params).id);
  if ("error" in s) return s.error;
  await db.delete(cmContracts).where(eq(cmContracts.id, s.contract.id));
  return NextResponse.json({ ok: true });
}
