import { Compass } from "lucide-react";
import { Button } from "@/components/ui";

/** Any address that isn't a page — on the navy ground of the sign-in screen, with a way back. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar-bg p-6">
      <div className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-float">
        <Compass size={22} className="text-accent" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-text">There&rsquo;s no page here</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">The link may be old, or mistyped.</p>
        <div className="mt-4">
          <Button variant="primary" href="/">
            Go to Today
          </Button>
        </div>
      </div>
    </div>
  );
}
