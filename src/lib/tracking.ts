/**
 * A carrier's tracking page for a tracking number, so nobody has to copy it
 * into the carrier's site. The carrier is taken from what was typed, or
 * guessed from the number's shape; null when it can't be told.
 */
export function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  const n = (number ?? "").replace(/\s+/g, "");
  if (!n) return null;
  const c = (carrier ?? "").toLowerCase();
  const q = encodeURIComponent(n);
  const ups = `https://www.ups.com/track?tracknum=${q}`;
  const usps = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${q}`;
  const fedex = `https://www.fedex.com/fedextrack/?trknbr=${q}`;
  const dhl = `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${q}`;
  if (c.includes("ups")) return ups;
  if (c.includes("usps") || c.includes("postal")) return usps;
  if (c.includes("fedex")) return fedex;
  if (c.includes("dhl")) return dhl;
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return ups;
  if (/^(94|93|92|95)\d{18,20}$/.test(n) || /^[A-Z]{2}\d{9}US$/i.test(n)) return usps;
  if (/^\d{12}$|^\d{15}$/.test(n)) return fedex;
  return null;
}
