import type { CmStage } from "@/lib/db/schema";
import { canonicalStage, exitReasonLabel, stageAction, stageLabel } from "@/lib/stages";

/**
 * The one line at the top of a creator's record that says what to do next.
 * Pure: derived from the stage plus the facts the stage summarises, so it
 * can be asserted offline.
 */
export interface NextStepInput {
  stage: CmStage;
  hasAddress: boolean;
  shipmentStatus: string | null;
  hasBrief: boolean;
  briefSent: boolean;
  deliverables: number;
  hasReplied: boolean;
  totalOutbound: number;
  followUpCount: number;
  daysSinceLastOutbound: number | null;
  datesAreMigrated: boolean;
  exitReason: string | null;
}

export interface NextStep {
  text: string;
  /** Card on the record page that holds the action. */
  anchor: "conversation" | "agreement" | "shipping" | "content" | "stage" | null;
}

export function nextStep(i: NextStepInput): NextStep {
  const stage = canonicalStage(i.stage);
  // Corrections and replacements can require shipping work after the stage advanced.
  if (stage === "content_pending" || stage === "posted") {
    if (i.shipmentStatus === "returned") return { text: "The shipment came back. Review the address and arrange a replacement.", anchor: "shipping" };
    if (i.shipmentStatus === "ready") return { text: "A shipment is ready. Confirm the address, send the package and record its tracking.", anchor: "shipping" };
  }
  switch (stage) {
    case "shortlisted":
      return {
        text:
          i.totalOutbound > 0
            ? "A message was logged but the stage didn't move — check the conversation, then set the stage."
            : "Send the first message. After an Instagram DM, click I messaged them; emails are picked up by themselves.",
        anchor: "conversation",
      };
    case "contacted": {
      if (i.datesAreMigrated) {
        return {
          text: "Imported from the old sheet — confirm where this conversation stands, then log a follow-up or close it.",
          anchor: "conversation",
        };
      }
      const days = i.daysSinceLastOutbound;
      const sent = i.followUpCount === 0 ? "first message" : `follow-up ${i.followUpCount}`;
      return {
        text:
          days == null
            ? "Waiting on a reply. Today shows when a follow-up is due."
            : `Waiting on a reply — ${sent} sent ${days === 0 ? "today" : `${days}d ago`}. Today shows when a follow-up is due.`,
        anchor: "conversation",
      };
    }
    case "in_conversation":
      return {
        text: "Work out whether they're in: agree the product, fee and videos, write them down under Deal, then move them to Agreed.",
        anchor: "agreement",
      };
    case "awaiting_address":
      return i.hasAddress
        ? { text: "Their address is on file — move them to Ready to ship.", anchor: "shipping" }
        : { text: "Get their shipping address and paste it under Shipping — the stage moves on its own.", anchor: "shipping" };
    case "fulfilling":
    case "shipped":
      switch (i.shipmentStatus) {
        case null:
          return { text: "Create the shipment: pick Ready under Shipping.", anchor: "shipping" };
        case "ready":
          return { text: "Ship the product, then mark it Shipped (add the tracking number).", anchor: "shipping" };
        case "shipped":
          return { text: "Mark Delivered when it lands, then send the brief.", anchor: "shipping" };
        case "delivered":
          return i.briefSent
            ? { text: "Brief sent — waiting on the video. Add it under Content when it's live.", anchor: "content" }
            : { text: "Product delivered — send the brief and mark it sent.", anchor: "content" };
        case "returned":
          return { text: "The shipment came back. Check the address and ship again, or close the deal.", anchor: "shipping" };
        default:
          return { text: "Track the shipment under Shipping.", anchor: "shipping" };
      }
    case "content_pending":
      return i.briefSent || i.hasBrief
        ? { text: "Waiting on their video. Paste the link under Content as soon as it's live.", anchor: "content" }
        : { text: "Send the brief and mark it sent, then wait for the video.", anchor: "content" };
    case "posted":
      return {
        text:
          i.deliverables > 0
            ? "The video is live. Check it matches what was agreed — nothing else to do."
            : "Marked Posted but no video recorded — paste the link under Content.",
        anchor: "content",
      };
    case "passed":
    case "declined":
    case "no_response": {
      const why = exitReasonLabel(i.exitReason);
      return {
        text: `Closed — ${stageLabel(stage).toLowerCase()}${why ? ` (${why.toLowerCase()})` : " — no reason recorded"}.${
          stage === "no_response" ? " A reply from them reopens it." : ""
        }`,
        anchor: why ? null : "stage",
      };
    }
    default:
      return { text: stageAction(stage) || "Open the creator and set the stage.", anchor: null };
  }
}
