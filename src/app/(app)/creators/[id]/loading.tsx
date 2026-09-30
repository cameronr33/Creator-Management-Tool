/** A creator's page while it loads: who, what's next, then the section cards. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the creator" className="animate-fade-in">
      <div className="border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="skeleton h-4 w-20" />
        <div className="mt-3 flex items-center gap-3">
          <div className="skeleton h-11 w-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="skeleton h-6 w-48" />
            <div className="skeleton mt-2 h-4 w-72 max-w-full" />
          </div>
        </div>
        <div className="skeleton mt-4 h-10 w-full max-w-2xl rounded-lg" />
      </div>
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl bg-surface p-4 shadow-card">
            <div className="skeleton h-5 w-36" />
            <div className="skeleton mt-3 h-3 w-full" />
            <div className="skeleton mt-2 h-3 w-5/6" />
            <div className="skeleton mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
