/**
 * Shown the moment you click a page, until it's ready: the page's outline —
 * a header and rows — so a click always shows it landed (interaction review,
 * 2026-09-30). Pipeline and a creator's page have their own shapes.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-fade-in">
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton mt-2 h-4 w-72" />
      </div>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="skeleton h-9 w-full rounded-xl" />
        <div className="overflow-hidden rounded-xl bg-surface shadow-card">
          <div className="border-b border-border px-4 py-3">
            <div className="skeleton h-4 w-32" />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3 border-t border-border px-4 py-3 first:border-t-0">
              <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton mt-2 h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
