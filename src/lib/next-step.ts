import type { CmStage } from "@/lib/db/schema";
import { exitReasonLabel, stageLabel } from "@/lib/stages";

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
  anchor: "conversation" | "agreement" | "shipping" | "content" | null;
}

export function nextStep(i: NextStepInput): NextStep {
  switch (i.stage) {
    case "researched":
      return { text: "Decide: shortlist them for outreach, or pass.", anchor: null };
    case "shortlisted":
      return {
        text:
          i.totalOutbound > 0
            ? "A message was logged but the stage didn't move — check the timeline, then set the stage."
            : "Send the first message — it's pre-written below.",
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
            ? "Waiting on a reply. Follow-ups come due automatically."
            : `Waiting on a reply — ${sent} sent ${days === 0 ? "today" : `${days}d ago`}. Follow-ups come due automatically; log the reply when it lands.`,
        anchor: "conversation",
      };
    }
    case "in_conversation":
      return {
        text: "They're interested. Agree the product, fee and number of videos, then move to Negotiating or Agreed.",
        anchor: "agreement",
      };
    case "negotiating":
      return { text: "Settle the terms, record them under Agreement, then mark Agreed.", anchor: "agreement" };
    case "agreed":
      return i.hasAddress
        ? { text: "Address on file — set up the shipment.", anchor: "shipping" }
        : { text: "Ask for their shipping address, or move to Awaiting address so it shows on the dashboard.", anchor: "shipping" };
    case "awaiting_address":
      return { text: "Paste their address under Shipping — the stage moves on its own.", anchor: "shipping" };
    case "fulfilling":
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
        ? { text: "Waiting on their video. Add the link under Content as soon as it's live.", anchor: "content" }
        : { text: "Send the brief and mark it sent, then wait for the video.", anchor: "content" };
    case "posted":
      return {
        text:
          i.deliverables > 0
            ? "Video is live. Check it meets the brief; mark Completed once everything agreed is delivered."
            : "Marked Posted but no video recorded — add the link under Content.",
        anchor: "content",
      };
    case "completed":
      return { text: "Nothing left to do. Everything agreed has been delivered.", anchor: null };
    case "passed":
    case "declined":
    case "no_response": {
      const why = exitReasonLabel(i.exitReason);
      return {
        text: `Closed — ${stageLabel(i.stage).toLowerCase()}${why ? ` (${why.toLowerCase()})` : " — no reason recorded"}.${
          i.stage === "no_response" ? " A late reply reopens them automatically." : ""
        }`,
        anchor: why ? null : "agreement",
      };
    }
  }
}
