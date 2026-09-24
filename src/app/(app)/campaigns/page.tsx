import { requireAgencyPage } from "@/lib/page-guards";
import { redirect } from "next/navigation";

/** Campaigns are managed in Settings and chosen in the sidebar. */
export default async function CampaignsPage() {
  await requireAgencyPage();
  redirect("/settings#campaigns");
}
