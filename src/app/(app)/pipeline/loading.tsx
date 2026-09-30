/** The Pipeline's outline while it loads: a header and a few columns of cards. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the Pipeline" className="animate-fade-in">
      <div className="border-b border-border bg-surface px-6 py-4">
        <div className="skeleton h-6 w-32" />
        <div className="skeleton mt-2 h-4 w-56" />
      </div>
      <div className="flex gap-3 overflow-hidden p-6">
        {[3, 2, 2, 1].map((n, c) => (
          <div key={c} className="w-60 shrink-0 space-y-2 rounded-xl border border-border bg-surface-2/60 p-2">
            <div className="skeleton mx-1 my-1.5 h-4 w-24" />
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="rounded-lg bg-surface p-2.5 shadow-control">
                <div className="flex items-center gap-2">
                  <div className="skeleton h-7 w-7 shrink-0 rounded-full" />
                  <div className="skeleton h-4 w-24" />
                </div>
                <div className="skeleton mt-2 h-3 w-full" />
                <div className="skeleton mt-1.5 h-3 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
