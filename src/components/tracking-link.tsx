import { trackingUrl } from "@/lib/tracking";

/** A tracking number, linked to the carrier's tracking page when the carrier can be told. */
export function TrackingLink({ carrier, number, label }: { carrier: string | null | undefined; number: string | null | undefined; label?: string }) {
  if (!number) return null;
  const text = label ?? [carrier, number].filter(Boolean).join(" ");
  const url = trackingUrl(carrier, number);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline" title="Open the carrier's tracking page">
      {text} ↗
    </a>
  ) : (
    <span>{text}</span>
  );
}
