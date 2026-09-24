/**
 * Verifies profile pictures: which links are fetched, which files are kept,
 * and the refresh → store → delete round trip. Instagram is mocked.
 *
 *   npm run preview:verify -- scripts/verify-photos.ts
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { downloadPhoto, isAllowedPhotoUrl, sniffImageType } from "../src/lib/photos";
import { isInstagramHandle, refreshFromInstagram } from "../src/lib/instagram";
import { createCreatorWithPartnership, ensureCampaignByName } from "../src/lib/creators";
import type { ApifyProfile } from "../src/lib/apify";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const PIC = "https://scontent-lax3-1.cdninstagram.com/v/t51/pic.jpg?x=1";

async function main() {
  console.log("\n── Which links and files are accepted (pure) ──");
  check("Instagram's picture host is allowed", isAllowedPhotoUrl(PIC));
  check("Facebook's CDN is allowed", isAllowedPhotoUrl("https://scontent.xx.fbcdn.net/a.jpg"));
  check("any other host is refused", !isAllowedPhotoUrl("https://evil.example/pic.jpg"));
  check("a lookalike host is refused", !isAllowedPhotoUrl("https://cdninstagram.com.evil.example/pic.jpg"));
  check("plain http is refused", !isAllowedPhotoUrl("http://scontent.cdninstagram.com/pic.jpg"));
  check("JPEG and PNG are recognised from their bytes", sniffImageType(JPEG) === "image/jpeg" && sniffImageType(PNG) === "image/png");
  check("SVG is never kept", sniffImageType(SVG) === null);
  check("real handles pass, name-only slugs don't", isInstagramHandle("shift_points") && isInstagramHandle("joe.hubbard") && !isInstagramHandle("jane-doe") && !isInstagramHandle("a b"));

  const realFetch = globalThis.fetch;
  let served: Uint8Array = JPEG;
  let contentType = "image/jpeg";
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname.endsWith(".cdninstagram.com")) return new Response(Buffer.from(served), { headers: { "content-type": contentType } });
    return realFetch(input, init);
  };
  try {
    console.log("\n── Downloading (Instagram mocked) ──");
    const ok = await downloadPhoto(PIC);
    check("a JPEG downloads", ok.ok && ok.mime === "image/jpeg");
    served = SVG;
    contentType = "image/jpeg"; // lies about its type
    const svg = await downloadPhoto(PIC);
    check("an SVG claiming to be a JPEG is refused", !svg.ok, JSON.stringify(svg));
    served = new Uint8Array(2 * 1024 * 1024 + 10);
    served.set(JPEG);
    check("a picture over 2 MB is refused", !(await downloadPhoto(PIC)).ok);
    check("a non-Instagram link is never fetched", !(await downloadPhoto("https://evil.example/pic.jpg")).ok);
    served = JPEG;

    console.log("\n── Refresh → stored → deleted with the creator (live DB) ──");
    const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
    const campaignId = await ensureCampaignByName(client.id, "__verify_photos__");
    const handle = { creatorId: "", partnershipId: "" };
    const named = { creatorId: "", partnershipId: "" };
    try {
      Object.assign(handle, await createCreatorWithPartnership({ clientId: client.id, name: "Verify Photo", links: ["https://www.instagram.com/__verify_photo__"], campaignId, stage: "shortlisted" }));
      Object.assign(named, await createCreatorWithPartnership({ clientId: client.id, name: "Verify Name Only", links: [], campaignId, stage: "shortlisted" }));
      const asked: string[][] = [];
      const fake = async (usernames: string[]): Promise<ApifyProfile[]> => {
        asked.push(usernames);
        return usernames.map((u) => ({ username: u, fullName: "V", followersCount: 12345, businessEmail: "verify-photo@example.test", profilePicUrl: PIC, verified: false }));
      };
      const r = await refreshFromInstagram([handle.creatorId, named.creatorId], { fetch: fake });
      check("only the creator with a real handle is looked up", asked.flat().join() === "__verify_photo__" && r.skipped === 1, JSON.stringify({ asked, r }));
      const [photo] = await db.select().from(schema.cmCreatorPhotos).where(eq(schema.cmCreatorPhotos.creatorId, handle.creatorId));
      check("the picture is stored as bytes, with its type", photo?.mime === "image/jpeg" && Buffer.from(photo.data, "base64").subarray(0, 3).equals(Buffer.from(JPEG.subarray(0, 3))));
      const [c] = await db.select().from(schema.cmCreators).where(eq(schema.cmCreators.id, handle.creatorId));
      check("followers and an empty email are filled", c.followers === 12345 && c.businessEmail === "verify-photo@example.test");
      await db.update(schema.cmCreators).set({ businessEmail: "mine@example.test" }).where(eq(schema.cmCreators.id, handle.creatorId));
      await refreshFromInstagram([handle.creatorId], { fetch: fake });
      const [c2] = await db.select().from(schema.cmCreators).where(eq(schema.cmCreators.id, handle.creatorId));
      const alts = await db.select().from(schema.cmCreatorEmails).where(eq(schema.cmCreatorEmails.creatorId, handle.creatorId));
      check("a saved email is never replaced — the new one is added alongside", c2.businessEmail === "mine@example.test" && alts.some((a) => a.email === "verify-photo@example.test"));
      check("refreshing again keeps one picture per creator", (await db.select().from(schema.cmCreatorPhotos).where(eq(schema.cmCreatorPhotos.creatorId, handle.creatorId))).length === 1);
    } finally {
      for (const id of [handle.creatorId, named.creatorId]) if (id) await db.delete(schema.cmCreators).where(eq(schema.cmCreators.id, id));
      await db.delete(schema.cmCampaigns).where(eq(schema.cmCampaigns.id, campaignId));
    }
    check("deleting the creator deletes the picture", handle.creatorId !== "" && (await db.select().from(schema.cmCreatorPhotos).where(eq(schema.cmCreatorPhotos.creatorId, handle.creatorId))).length === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
