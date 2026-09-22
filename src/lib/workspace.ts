import type { CmStage } from "@/lib/db/schema";
import type { OutreachState, FollowUpThresholds } from "@/lib/outreach";
import { nextStep } from "@/lib/next-step";
import { isTerminal } from "@/lib/stages";

export type WorkLane = "action" | "waiting" | "review" | "closed";
export type CreatorTab = "overview" | "profile" | "conversation" | "agreement" | "shipping" | "content";
export function clearCreatorFilters(query: string): string {
  const next = new URLSearchParams(query);
  ["q", "campaign", "stage", "selected"].forEach(key => next.delete(key));
  return next.toString();
}
export interface WorkspaceFacts {
  partnershipId: string; creatorId: string; name: string; username: string;
  campaignId: string; campaignName: string; profileUrl: string; contentPillar: string | null;
  followers: number | null; avgViews: number | null; viewsSource: string | null; businessEmail: string | null;
  stage: CmStage; agreementType: string | null; hasAddress: boolean; hasBrief: boolean;
  briefSent: boolean; exitReason: string | null; shipments: { status: string }[]; deliverables: number;
  outreach: OutreachState; thresholds: FollowUpThresholds;
}
export interface WorkspaceItem {
  partnershipId: string; creatorId: string; name: string; username: string;
  campaignId: string; campaignName: string; profileUrl: string; contentPillar: string | null;
  followers: number | null; avgViews: number | null; viewsSource: string | null; businessEmail: string | null;
  stage: CmStage; lane: WorkLane; action: string; next: string; tab: CreatorTab;
  waitingOn: string; dueLabel: string | null; agreement: string; shipping: string; content: string;
  lastContact: string; issues: string[];
}

/** Read-only work suggestions. These never change stages or infer email intent. */
export function deriveWorkspaceItem(f: WorkspaceFacts): WorkspaceItem {
  const statuses = f.shipments.map(s => s.status);
  const shipped = statuses.some(s => s === "shipped" || s === "delivered");
  const issues: string[] = [];
  if (statuses.length > 1) issues.push(`${statuses.length} shipment records; confirm each package and its current status.`);
  if (statuses.includes("ready") && !f.hasAddress) issues.push("A shipment is marked ready, but the address is incomplete.");
  if (shipped && ["researched", "shortlisted", "contacted", "in_conversation", "negotiating", "agreed", "awaiting_address"].includes(f.stage)) {
    issues.push("Shipping activity is ahead of the recorded stage. Check the evidence before updating it.");
  }
  if (f.stage === "posted" && f.deliverables === 0) issues.push("The stage says posted, but no publication is recorded.");
  if (f.stage === "contacted" && f.outreach.datesAreMigrated) issues.push("The imported outreach has no known contact date. Confirm the conversation status.");
  const step = nextStep({
    stage: f.stage, hasAddress: f.hasAddress, shipmentStatus: statuses.length === 1 ? statuses[0] : null,
    hasBrief: f.hasBrief, briefSent: f.briefSent, deliverables: f.deliverables,
    ...f.outreach, exitReason: f.exitReason,
  });
  let action = "Review creator";
  let lane: WorkLane = "action";
  let tab: CreatorTab = (step.anchor as CreatorTab | null) ?? "profile";
  let waitingOn = "Our team";
  let dueLabel: string | null = null;
  switch (f.stage) {
    case "researched": action = "Review profile & research"; tab = "profile"; break;
    case "shortlisted": action = "Prepare first message"; tab = "conversation"; break;
    case "contacted": {
      const days = f.outreach.daysSinceLastOutbound;
      const threshold = f.outreach.followUpCount === 0 ? f.thresholds.followUp1AfterDays : f.thresholds.followUp2AfterDays;
      if (f.outreach.hasReplied) { action = "Review reply & stage"; break; }
      if (days != null && days >= threshold && f.outreach.followUpCount < 2 && !f.outreach.datesAreMigrated) {
        action = "Prepare follow-up"; dueLabel = "Follow-up due";
      } else if (f.outreach.followUpCount >= 2 && days != null && days >= f.thresholds.markNoResponseAfterDays && !f.outreach.datesAreMigrated) {
        action = "Review unanswered outreach"; lane = "review"; waitingOn = "Our team";
      } else { action = "Waiting for a reply"; lane = "waiting"; waitingOn = "Creator"; }
      break;
    }
    case "in_conversation": action = "Review conversation"; tab = "conversation"; break;
    case "negotiating": action = "Confirm partnership terms"; break;
    case "agreed": action = f.hasAddress ? "Set up shipment" : "Request shipping address"; break;
    case "awaiting_address":
      action = f.hasAddress ? "Review address & stage" : "Waiting for an address";
      lane = f.hasAddress ? "action" : "waiting"; waitingOn = f.hasAddress ? "Our team" : "Creator"; break;
    case "fulfilling":
      if (statuses[0] === "shipped") { action = "Track delivery"; lane = "waiting"; waitingOn = "Carrier"; }
      else if (statuses[0] === "returned") action = "Resolve returned shipment";
      else if (statuses[0] === "delivered") {
        action = f.briefSent ? "Check on content" : "Send the content brief";
        lane = f.briefSent ? "waiting" : "action"; waitingOn = f.briefSent ? "Creator" : "Our team";
      } else action = statuses[0] === "ready" && f.hasAddress ? "Ship product" : "Set up shipment";
      break;
    case "content_pending":
      action = f.briefSent ? "Check on content" : "Send the content brief";
      lane = f.briefSent ? "waiting" : "action"; waitingOn = f.briefSent ? "Creator" : "Our team"; break;
    case "posted": action = "Review agreed deliverables"; break;
    default: action = "Open partnership history"; tab = "overview";
  }
  if (["content_pending", "posted"].includes(f.stage) && statuses.some(s => s === "ready" || s === "returned")) {
    action = statuses.includes("returned") ? "Resolve returned shipment" : "Ship product";
    lane = "action"; tab = "shipping"; waitingOn = "Our team";
  }
  if (issues.length && !isTerminal(f.stage) && f.stage !== "completed") {
    lane = "review"; action = "Review record"; waitingOn = "Our team"; dueLabel = null;
    tab = issues[0].includes("shipment") || issues[0].includes("Shipping") ? "shipping" : f.stage === "posted" ? "content" : "conversation";
  }
  if (isTerminal(f.stage) || f.stage === "completed") { lane = "closed"; waitingOn = "—"; }
  const lastContact = f.outreach.datesAreMigrated
    ? "Imported · date unknown"
    : f.outreach.lastContactAt
      ? f.outreach.lastContactAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      : "No contact recorded";
  return {
    partnershipId: f.partnershipId, creatorId: f.creatorId, name: f.name, username: f.username,
    campaignId: f.campaignId, campaignName: f.campaignName, profileUrl: f.profileUrl, contentPillar: f.contentPillar,
    followers: f.followers, avgViews: f.avgViews, viewsSource: f.viewsSource, businessEmail: f.businessEmail,
    stage: f.stage, lane, action,
    next: issues.length && lane === "review" ? issues[0] : action === "Review unanswered outreach" ? "Check the full conversation, including off-channel replies, before closing as no response." : step.text,
    tab, waitingOn, dueLabel,
    agreement: f.agreementType === "signed" ? "Signed recorded" : f.agreementType === "verbal" ? "Verbal agreement" : "No agreement recorded",
    shipping: statuses.length > 1 ? `${statuses.length} records · ${statuses.join(", ")}` : statuses[0] ? statuses[0][0].toUpperCase() + statuses[0].slice(1) : "No shipment recorded",
    content: f.deliverables ? `${f.deliverables} published · check against terms` : f.briefSent ? "Brief sent · no publication recorded" : "No publication recorded",
    lastContact, issues,
  };
}
