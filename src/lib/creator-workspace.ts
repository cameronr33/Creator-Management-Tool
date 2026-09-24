/** The sections of the (single, scrolling) creator page, in page order. */
export const CREATOR_SECTIONS = [
  { value: "overview", label: "Overview" },
  { value: "conversation", label: "Conversation" },
  { value: "agreement", label: "Deal" },
  { value: "shipping", label: "Shipping" },
  { value: "content", label: "Content" },
  { value: "profile", label: "Profile" },
] as const;

export type CreatorSection = (typeof CREATOR_SECTIONS)[number]["value"];

export function safeCreatorReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/creators";
  try {
    const parsed = new URL(value, "https://creator-workspace.invalid");
    if (!["/", "/creators", "/pipeline"].includes(parsed.pathname) || parsed.hash) return "/creators";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/creators";
  }
}

/** A link to one section of a creator's page (it's one page: the section is an anchor). */
export function creatorSectionHref(id: string, section: CreatorSection, returnTo?: string) {
  const query = returnTo ? `?${new URLSearchParams({ returnTo: safeCreatorReturnTo(returnTo) })}` : "";
  return `/creators/${encodeURIComponent(id)}${query}${section === "overview" ? "" : `#${section}`}`;
}

/** A delivered parcel cannot hide another parcel that still needs attention. */
export function shipmentAttentionStatus(shipments: readonly { status: string }[]): string | null {
  for (const status of ["returned", "ready", "shipped", "delivered"]) {
    if (shipments.some((shipment) => shipment.status === status)) return status;
  }
  return shipments.length ? "unknown" : null;
}

export function shipmentSummary(shipments: readonly { status: string }[]): string {
  if (!shipments.length) return "No shipment recorded";
  const labels = ["ready", "shipped", "delivered", "returned"];
  return labels
    .map((status) => {
      const count = shipments.filter((shipment) => shipment.status === status).length;
      return count ? `${count} ${status}` : null;
    })
    .filter(Boolean)
    .join(" · ") || "Status unknown";
}

export function timelineSource(event: { isMigrated: boolean | null; channel: string; externalId: string | null }) {
  if (event.isMigrated) return "Imported from sheet";
  if (event.channel === "email" && event.externalId) return "Synced email";
  return "Manually logged";
}
