import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth, assertCreatorInSelectedClient } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmCreatorPhotos } from "@/lib/db/schema";

/**
 * GET /api/creators/[id]/photo?v=<fetched time> — the stored profile picture.
 * Signed-in, same-client only. The ?v= changes whenever the picture is
 * re-fetched, so each URL's bytes never change and can be cached for good.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;
  const { id } = await ctx.params;
  const scope = await assertCreatorInSelectedClient(id);
  if (scope) return scope;
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
