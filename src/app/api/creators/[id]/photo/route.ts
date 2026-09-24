import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAgency, assertCreatorInSelectedClient, isClientSession } from "@/lib/api-helpers";
import { auth } from "@/lib/auth";
import { activeClientPerson } from "@/lib/client-session";
import { db } from "@/lib/db";
import { cmCreatorPhotos, cmCreators } from "@/lib/db/schema";

/**
 * GET /api/creators/[id]/photo?v=<fetched time> — the stored profile picture.
 * The agency sees the selected client's; a client login only their own brand's.
 * The ?v= changes whenever the picture is
 * re-fetched, so each URL's bytes never change and can be cached for good.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (isClientSession(session)) {
    const person = await activeClientPerson(session);
    if (!person) return new NextResponse(null, { status: 401 });
    const [c] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select({ clientId: cmCreators.clientId }).from(cmCreators).where(eq(cmCreators.id, id)).limit(1) : [];
    if (!c || c.clientId !== person.clientId) return new NextResponse(null, { status: 404 });
  } else {
    const { error } = await requireAgency();
    if (error) return error;
    const scope = await assertCreatorInSelectedClient(id);
    if (scope) return scope;
  }
  const [photo] = await db.select({ mime: cmCreatorPhotos.mime, data: cmCreatorPhotos.data }).from(cmCreatorPhotos).where(eq(cmCreatorPhotos.creatorId, id)).limit(1);
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(photo.data, "base64")), {
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
