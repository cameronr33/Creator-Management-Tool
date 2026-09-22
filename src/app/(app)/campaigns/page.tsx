import { redirect } from "next/navigation";

/** Campaigns are managed in Settings and chosen in the sidebar. */
export default function CampaignsPage() {
  redirect("/settings#campaigns");
}
