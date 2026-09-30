import { redirect } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { ApprovalButtons } from "@/components/approval-buttons";
import { PortalCreatorHeader } from "@/components/portal";
import { getPortalContext, getPortalCreators } from "@/lib/portal-data";

/** Creators waiting for the brand's go-ahead before anyone reaches out. */
export default async function PortalApprove() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  const waiting = (await getPortalCreators(ctx.clientId)).filter((c) => c.clientApproval === "pending" && c.stage === "shortlisted");
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">Approve creators</h1>
        <p className="text-sm text-text-muted">We won&apos;t reach out to these creators until you approve. Pass on anyone who isn&apos;t right — a reason helps us find better ones.</p>
      </div>
      {waiting.length === 0 ? (
        <EmptyState title="Nothing waiting for you" hint="New creators appear here when we shortlist them for you." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {waiting.map((c) => (
              <li key={c.partnershipId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <PortalCreatorHeader c={c} showStage={false} />
                <ApprovalButtons partnershipId={c.partnershipId} name={c.name} who="client" readOnly={ctx.readOnly} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
