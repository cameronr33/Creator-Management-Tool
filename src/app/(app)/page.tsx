import Link from "next/link";
import { ArrowRight, Send, MapPin, Package, Clapperboard, MailWarning } from "lucide-react";
import { resolveClient, getStageCounts } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getDashboardStalls, type StallItem } from "@/lib/dashboard";
import { countOpenSuggestions } from "@/lib/email-suggestions";
import { PageHeader, Card, StatTile, EmptyState, Avatar, Callout, Button } from "@/components/ui";
import { QueueItemAction, type QueueKind } from "@/components/queue-actions";
import { STAGES, ACTIVE_STAGES, stageLabel, stageHint } from "@/lib/stages";

export default async function DashboardPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-6">
          <EmptyState
            title="No clients to show"
            hint="Every client is hidden. Un-hide one under Settings → Clients, or run the import."
            action={<Button href="/settings">Open settings</Button>}
          />
        </div>
      </>
    );
  }

  const [counts, stalls, unmatched] = await Promise.all([
    getStageCounts(client.id),
    getDashboardStalls(client.id),
    countOpenSuggestions(),
  ]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = ACTIVE_STAGES.reduce((sum, s) => sum + (counts[s.value] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        client={client.name}
        subtitle={`${total} creators · ${active} in the active pipeline`}
        help="What's stuck today. Each list is a to-do — act straight from the row, or open the creator."
        helpAnchor="daily-loop"
      />
      <div className="space-y-6 p-6">
        {unmatched > 0 && (
          <Callout
            tone="warn"
            icon={<MailWarning size={16} />}
            actions={
              <Button size="sm" href="/settings#email-sync">
                Link senders
              </Button>
            }
          >
            <strong>{unmatched}</strong>
            {` email sender${unmatched === 1 ? "" : "s"} on cc'd threads ${
              unmatched === 1 ? "isn't" : "aren't"
            } linked to a creator yet, so their replies aren't being tracked.`}
          </Callout>
        )}

        {/* The four stall queues — what actually needs action today. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StallQueue
            title="Messages to send"
            hint="First messages and follow-ups that are due, from the follow-up clock."
            icon={<Send size={16} />}
            items={stalls.followUpsDue}
            tone="warn"
            emptyLabel="Nothing due — nobody's overdue"
            queue="follow_ups"
          />
          <StallQueue
            title="Waiting on an address"
            hint="Agreed deals that can't ship until the creator sends where to."
            icon={<MapPin size={16} />}
            items={stalls.awaitingAddress}
            tone="warn"
            emptyLabel="Every agreed deal has an address"
            queue="awaiting_address"
          />
          <StallQueue
            title="Ready to ship"
            hint="Address in hand, product not sent yet."
            icon={<Package size={16} />}
            items={stalls.readyToShip}
            tone="accent"
            emptyLabel="Nothing waiting to ship"
            queue="ready_to_ship"
          />
          <StallQueue
            title="Shipped, no video yet"
            hint="Product on its way or delivered, and no posted video recorded."
            icon={<Clapperboard size={16} />}
            items={stalls.deliveredNoVideo}
            tone="accent"
            emptyLabel="No videos outstanding"
            queue="delivered_no_video"
          />
        </div>

        {/* Pipeline distribution. */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Pipeline</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-sm text-accent hover:underline">
              Open the board <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {STAGES.map((s) => (
              <StatTile
                key={s.value}
                href={`/creators?stage=${s.value}`}
                label={stageLabel(s.value)}
                value={counts[s.value] ?? 0}
                title={stageHint(s.value)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function StallQueue({
  title,
  hint,
  icon,
  items,
  tone,
  emptyLabel,
  queue,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  items: StallItem[];
  tone: "warn" | "accent";
  emptyLabel: string;
  queue: QueueKind;
}) {
  const ring = tone === "warn" ? "ring-warn-line" : "ring-info-line";
  return (
    <Card className={`flex flex-col ring-1 ring-inset ${ring}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3" title={hint}>
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <span className={tone === "warn" ? "text-warn" : "text-accent"}>{icon}</span>
          {title}
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular text-text-muted">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-text-muted">{emptyLabel}</div>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {items.map((it) => (
            <li key={it.partnershipId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Link
                href={`/creators/${it.partnershipId}`}
                className="flex min-w-[11rem] flex-1 items-center gap-2.5 transition hover:opacity-80"
              >
                <Avatar name={it.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{it.name}</div>
                  <div className="truncate text-xs text-text-muted">{it.detail}</div>
                </div>
              </Link>
              <QueueItemAction queue={queue} item={it} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
