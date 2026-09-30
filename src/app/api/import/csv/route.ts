import { NextResponse, after, type NextRequest } from "next/server";
import { requireAgency, badRequest } from "@/lib/api-helpers";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { applyImport, parseImportFile, planImport } from "@/lib/csv-import";
import { refreshFromInstagram } from "@/lib/instagram";
import { checkEmailForNewAddress } from "@/lib/gmail-sync";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/import/csv — multipart: file, defaultCampaign, mode.
 * mode=preview reads only and returns the row-by-row plan; mode=import does
 * it, then fetches photos and followers (and checks email for any new
 * addresses) in the background. Always into the client selected in the sidebar.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Choose a CSV file to import, then try again.");
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Choose a CSV file first");
  if (file.size > MAX_BYTES) return badRequest("That file is over 2 MB — split it into smaller files");
  const mode = String(form.get("mode") ?? "preview");
  const defaultCampaign = String(form.get("defaultCampaign") ?? "").trim();

  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) return badRequest("Pick a client in the sidebar first");

  const parsed = parseImportFile(await file.text(), defaultCampaign);
  if (parsed.rows.length === 0) {
    return badRequest(parsed.problems[0]?.message ?? "No creators found in that file", { problems: parsed.problems });
  }

  if (mode !== "import") {
    const plan = await planImport(client.id, parsed);
    return NextResponse.json({ ok: true, client: client.name, ...plan });
  }

  const result = await applyImport(client.id, parsed, session.user.id);
  after(async () => {
    if (result.touchedCreatorIds.length) await refreshFromInstagram(result.touchedCreatorIds).catch(() => undefined);
    if (result.withEmail) await checkEmailForNewAddress();
  });
  return NextResponse.json({ ok: true, client: client.name, problems: parsed.problems, ...result });
}
