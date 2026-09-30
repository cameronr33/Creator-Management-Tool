import { UserX } from "lucide-react";
import { Button, Card } from "@/components/ui";

/** A creator link that no longer points anywhere — removed, or an old link from an email. */
export default function CreatorNotFound() {
  return (
    <div className="p-4 sm:p-6">
      <Card className="mx-auto mt-6 max-w-lg p-5">
        <div className="flex items-start gap-3">
          <UserX size={20} className="mt-0.5 shrink-0 text-text-faint" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text">This creator isn&rsquo;t here any more</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              They may have been removed from the campaign, or the link came from an old email.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" href="/creators">
                Back to Creators
              </Button>
              <Button variant="ghost" href="/creators?archived=1">
                Look in Archived
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
