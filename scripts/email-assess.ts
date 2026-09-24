/**
 * Read creator conversations the way the app does after every email check.
 *
 *   npm run email:assess -- --dry-run                    # every conversation with email; writes nothing
 *   npm run email:assess -- --dry-run --partnership <id> # just one
 *   npm run email:assess -- --apply                      # record summaries, fill blank deal fields; move stages only if EMAIL_AUTOMOVE=on
 *
 * The dry run shows what WOULD move with the switch on, so a person can check
 * the email reader's judgment on real conversations before trusting it.
 */
import { isNotNull, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { assessPartnership, emailAutomoveOn } from "../src/lib/email-status";
import { stageLabel } from "../src/lib/stages";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (!apply && !args.includes("--dry-run")) throw new Error("Pass --dry-run or --apply");
  const only = args.includes("--partnership") ? args[args.indexOf("--partnership") + 1] : null;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const ids = only
    ? [only]
    : [
        ...new Set(
          (
            await db
              .selectDistinct({ id: schema.cmOutreachEvents.partnershipId })
              .from(schema.cmOutreachEvents)
              .where(isNotNull(schema.cmOutreachEvents.externalId))
          ).map((r) => r.id),
        ),
      ];
  console.log(`${ids.length} conversation(s) with email · ${apply ? `APPLY (automatic moves ${emailAutomoveOn() ? "ON" : "off"})` : "dry run — nothing written"}\n`);

  for (const id of ids) {
    // Dry run evaluates as if the switch were on, to show what it would do.
    const o = await assessPartnership(id, { apply, automove: apply ? emailAutomoveOn() : true });
    const [p] = await db.select({ stage: schema.cmPartnerships.stage }).from(schema.cmPartnerships).where(eq(schema.cmPartnerships.id, id));
    console.log(`■ ${o.creatorName} — now ${stageLabel(o.current)}`);
    if (o.skipped) {
      console.log(`  skipped: ${o.skipped}\n`);
      continue;
    }
    const a = o.assessment!;
    console.log(`  reads as: ${stageLabel(a.stage)} (${a.confidence}) · whose turn: ${a.whose_turn}${a.sounds_like_no ? " · SOUNDS LIKE A NO" : ""}`);
    console.log(`  latest:   ${a.summary}`);
    console.log(`  quote:    [${a.evidence_message}] "${a.evidence_quote}"`);
    if (o.suggestedAddress) console.log(`  address found in their email: ${o.suggestedAddress.replace(/\s*\n\s*/g, ", ")}`);
    const deal = o.dealFound;
    if (deal && (deal.products.length || deal.fee_amount != null || deal.terms)) {
      const parts = [
        deal.products.length ? `products: ${deal.products.map((p) => `${p.name}${(p.quantity ?? 1) > 1 ? ` × ${p.quantity}` : ""}`).join(", ")}` : null,
        deal.fee_amount != null ? `fee $${deal.fee_amount}` : null,
        deal.terms ? `terms: ${deal.terms}` : null,
      ].filter(Boolean);
      console.log(`  deal in their email: ${parts.join(" · ")}`);
    }
    if (o.dealFilled?.length) console.log(`  FILLED (were blank): ${o.dealFilled.join(", ")}`);
    if (o.decision?.move) {
      console.log(`  ${apply ? (o.moved ? "MOVED" : "would move, but") : "WOULD MOVE"}: ${stageLabel(o.current)} → ${stageLabel(o.decision.move.to)}${o.decision.move.videoUrl ? ` (video ${o.decision.move.videoUrl})` : ""}${o.decision.move.markDelivered ? " (marks the shipment delivered)" : ""}`);
    } else {
      console.log(`  no move: ${o.decision && "why" in o.decision ? o.decision.why : "—"}`);
    }
    if (apply) console.log(`  stage now: ${p ? stageLabel(p.stage) : "?"}`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
