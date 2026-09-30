"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";

/**
 * A page that failed to load, in the app's own words instead of the
 * framework's error screen. Try again re-fetches just this page; the sidebar
 * stays. Nothing a teammate saved is affected — saves happen elsewhere.
 */
export default function PageError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="p-4 sm:p-6">
      <Card className="mx-auto mt-6 max-w-lg p-5">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="mt-0.5 shrink-0 text-bad" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text">This page didn&rsquo;t load</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              The database took too long to answer, or something went wrong on our side. Nothing you saved is lost.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => unstable_retry()}>
                Try again
              </Button>
              <Button variant="ghost" href="/">
                Go to Today
              </Button>
            </div>
            {error.digest && <p className="mt-3 text-xs text-text-faint">Reference for support: {error.digest}</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}
