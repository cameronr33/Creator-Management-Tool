import Link from "next/link";
import { ArrowRight, Send, MapPin, Package, Clapperboard } from "lucide-react";
import { resolveClient } from "@/lib/queries";
import { getSelectedClientSlug } from "@/lib/client-cookie";
import { getStageCounts } from "@/lib/queries";
import { getDashboardStalls, type StallItem } from "@/lib/dashboard";
import { PageHeader, Card, StatTile, EmptyState, Avatar } from "@/components/ui";
import { STAGES, ACTIVE_STAGES, stageLabel } from "@/lib/stages";

export default async function DashboardPage() {
  const client = await resolveClient(await getSelectedClientSlug());
  if (!client) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="p-6">
          <EmptyState
            title="No clients yet"
            hint="Run the HELLA import or add a client in Settings to get started."
          />
        </div>
      </>
    );
  }

  const [counts, stalls] = await Promise.all([
    getStageCounts(client.id),
    getDashboardStalls(client.id),
  ]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = ACTIVE_STAGES.reduce((sum, s) => sum + (counts[s.value] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${client.name} · ${total} creators, ${active} in active pipeline`}
      />
      <div className="space-y-6 p-6">
        {/* The four stall queues — what actually needs action today. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StallQueue
            title="Follow-ups due"
            icon={<Send size={16} />}
            items={stalls.followUpsDue}
            tone="warn"
            emptyLabel="Nobody's overdue"
          />
          <StallQueue
            title="Awaiting address"
            icon={<MapPin size={16} />}
            items={stalls.awaitingAddress}
            tone="warn"
            emptyLabel="All agreed deals have addresses"
          />
          <StallQueue
            title="Ready to ship"
            icon={<Package size={16} />}
            items={stalls.readyToShip}
            tone="accent"
            emptyLabel="Nothing waiting to ship"
          />
          <StallQueue
            title="Delivered, no video"
            icon={<Clapperboard size={16} />}
            items={stalls.deliveredNoVideo}
            tone="accent"
            emptyLabel="No pending videos"
          />
        </div>

        {/* Pipeline distribution. */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Pipeline</h2>
            <Link href="/pipeline" className="flex items-center gap-1 text-sm text-accent hover:underline">
              Open board <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {STAGES.map((s) => (
              <Link key={s.value} href={`/creators?stage=${s.value}`}>
                <StatTile label={stageLabel(s.value)} value={counts[s.value] ?? 0} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function StallQueue({
  title,
  icon,
  items,
  tone,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  items: StallItem[];
  tone: "warn" | "accent";
  emptyLabel: string;
}) {
  const ring = tone === "warn" ? "ring-amber-200" : "ring-indigo-200";
  return (
    <Card className={`flex flex-col ring-1 ring-inset ${ring}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <span className={tone === "warn" ? "text-amber-600" : "text-accent"}>{icon}</span>
          {title}
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular text-text-muted">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-text-faint">{emptyLabel}</div>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {items.slice(0, 12).map((it) => (
            <li key={it.partnershipId}>
              <Link
                href={`/creators/${it.partnershipId}`}
                className="flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-surface-2"
              >
                <Avatar name={it.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{it.name}</div>
                  <div className="truncate text-xs text-text-muted">{it.detail}</div>
                </div>
              </Link>
            </li>
          ))}
          {items.length > 12 && (
            <li className="px-4 py-2 text-center text-xs text-text-faint">
              +{items.length - 12} more
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
