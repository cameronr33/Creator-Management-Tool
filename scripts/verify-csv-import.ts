/**
 * Verifies the CSV import: reading any reasonable sheet, the preview writing
 * nothing, campaigns created once, a re-import changing nothing, and existing
 * creators only ever gaining (never losing) what they have.
 *
 *   npm run preview:verify -- scripts/verify-csv-import.ts
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { applyImport, parseImportFile, planImport } from "../src/lib/csv-import";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  console.log("\n── Reading the file (pure) ──");
  const plain = parseImportFile("name,campaign\nJane Doe,Spring\nSam,spring \n", "");
  check("lowercase headers and a plain list of names work", plain.rows.length === 2 && plain.rows[0].name === "Jane Doe" && plain.rows[0].handle === null);
  check('one campaign, one spelling: "spring " joins "Spring" (the first spelling in the file)', plain.rows[1].campaign === "Spring");
  const aliases = parseImportFile("Creator Name,Campaign Name,IG,E-mail\nA,X,@a.b,A@Example.com\n", "");
  check("header aliases (Creator Name, IG, E-mail) are recognised", aliases.rows[0]?.handle === "a.b" && aliases.rows[0]?.email === "a@example.com" && aliases.rows[0]?.campaign === "X");
  const forms = parseImportFile("Name,Instagram\nA,https://www.instagram.com/some.one/\nB,@other_one\nC,plainhandle\n", "Default");
  check("handles come from links, @handles and bare handles", forms.rows.map((r) => r.handle).join() === "some.one,other_one,plainhandle");
  check("a blank campaign uses the form's default", forms.rows.every((r) => r.campaign === "Default"));
  check("no default and no column → General", parseImportFile("Name\nA\n", "").rows[0]?.campaign === "General");
  const handleOnly = parseImportFile("Instagram\n@solo\n", "");
  check("a handle with no name uses the handle as the name", handleOnly.rows[0]?.name === "solo");
  const dupes = parseImportFile("Name,Campaign,Instagram\nA,X,@a\nA again,X,@a\nA,Y,@a\n", "");
  check("the same creator twice in one campaign is skipped with a reason", dupes.rows.length === 2 && /line 2/.test(dupes.problems[0]?.message ?? ""), JSON.stringify(dupes.problems));
  const bad = parseImportFile("Name,Email\n,\nB,not-an-email\n", "");
  check("a bad email is reported by line, never silently dropped", bad.rows.length === 0 && bad.problems.some((p) => p.line === 3 && /email/.test(p.message)));
  check("a file with no Name or Instagram column says so", parseImportFile("Foo,Bar\n1,2\n", "").problems[0]?.message.includes("Name") === true);
  const research = parseImportFile("Username,Followers,Avg Views (IG),Views Source,Campaign\nres.one,1200,5000,IG public (Chrome),R\n", "");
  check("the research CSV still reads (numbers come along)", research.rows[0]?.handle === "res.one" && research.rows[0]?.followers === 1200 && research.rows[0]?.avgViews === 5000);

  console.log("\n── Preview, import, re-import (live DB) ──");
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const tag = `__verify_csv_${Date.now()}`;
  // Instagram handles are at most 30 characters.
  const h = `vcsv${Date.now() % 1e8}`;
  const file = [
    "Name,Campaign,Instagram,Email",
    `Verify One,${tag} Alpha,@${h}_one,one@${h}.test`,
    `Verify Two,${tag} alpha,,`,
    `Verify Three,${tag} Beta,@${h}_three,`,
  ].join("\n");
  const campaignsNow = () => db.select().from(schema.cmCampaigns).where(sql`${schema.cmCampaigns.name} ilike ${tag + "%"}`);
  const creatorsNow = () => db.select().from(schema.cmCreators).where(sql`${schema.cmCreators.name} like 'Verify %' and (${schema.cmCreators.username} like ${h + "%"} or ${schema.cmCreators.name} = 'Verify Two')`);
  try {
    const parsed = parseImportFile(file, "");
    const plan = await planImport(client.id, parsed);
    check("the preview counts three new creators and two new campaigns", plan.counts.new === 3 && plan.newCampaigns.length === 2, JSON.stringify({ c: plan.counts, n: plan.newCampaigns }));
    check("…and writes nothing", (await campaignsNow()).length === 0 && (await creatorsNow()).length === 0);

    const first = await applyImport(client.id, parsed);
    const camps = await campaignsNow();
    check("importing creates each campaign once, whatever its capitals", camps.length === 2 && first.campaignsCreated.length === 2, JSON.stringify(camps.map((c) => c.name)));
    check("three creators are created", first.created === 3 && first.failed.length === 0, JSON.stringify(first));
    const made = await creatorsNow();
    const two = made.find((c) => c.name === "Verify Two");
    check("a name-only creator gets no guessed Instagram link", two?.profileUrl === "" && two?.platform === "other", JSON.stringify(two));
    const parts = await db.select().from(schema.cmPartnerships).where(inArray(schema.cmPartnerships.creatorId, made.map((c) => c.id)));
    check("everyone starts in To contact", parts.length === 3 && parts.every((p) => p.stage === "shortlisted"));
    const trans = await db.select().from(schema.cmStageTransitions).where(inArray(schema.cmStageTransitions.partnershipId, parts.map((p) => p.id)));
    check("…with a history row each", trans.length === 3);

    const again = await applyImport(client.id, parseImportFile(file, ""));
    check("importing the same file again changes nothing", again.created === 0 && again.addedToCampaign === 0 && again.alreadyThere === 3 && (await creatorsNow()).length === 3, JSON.stringify(again));

    // An existing creator joins another campaign; what they already have is kept.
    const one = made.find((c) => c.username === `${h}_one`)!;
    await db.update(schema.cmCreators).set({ viewsSource: "ig_public_chrome", avgViews: 999 }).where(eq(schema.cmCreators.id, one.id));
    const more = parseImportFile(`Name,Campaign,Instagram,Email,Avg Views (IG),Views Source\nRenamed,${tag} Beta,@${h}_one,other@${h}.test,5,apify\nVerify Two,${tag} Beta,,\n`, "");
    const joinPlan = await planImport(client.id, more);
    check("the preview says an existing creator joins the campaign", joinPlan.counts.added_to_campaign === 2, JSON.stringify(joinPlan.counts));
    const joined = await applyImport(client.id, more);
    const [oneAfter] = await db.select().from(schema.cmCreators).where(eq(schema.cmCreators.id, one.id));
    check("an existing creator joins the new campaign rather than being duplicated", joined.addedToCampaign === 2 && joined.created === 0, JSON.stringify(joined));
    check("their name and email are kept (a new email is added alongside)", oneAfter.name === "Verify One" && oneAfter.businessEmail === `one@${h}.test`);
    const alts = await db.select().from(schema.cmCreatorEmails).where(eq(schema.cmCreatorEmails.creatorId, one.id));
    check("…the new address is tracked too", alts.some((a) => a.email === `other@${h}.test`));
    check("hand-checked views are never replaced by estimated ones", oneAfter.avgViews === 999 && oneAfter.viewsSource === "ig_public_chrome");
    check("a name-only row joins the one existing creator with that name", (await creatorsNow()).filter((c) => c.name === "Verify Two").length === 1);
  } finally {
    const made = await creatorsNow();
    if (made.length) await db.delete(schema.cmCreators).where(inArray(schema.cmCreators.id, made.map((c) => c.id)));
    const camps = await campaignsNow();
    if (camps.length) await db.delete(schema.cmCampaigns).where(inArray(schema.cmCampaigns.id, camps.map((c) => c.id)));
  }
  check("test rows cleaned up", (await creatorsNow()).length === 0 && (await campaignsNow()).length === 0);
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
