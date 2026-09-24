"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSelectedClientSlug } from "@/lib/client-cookie";
import { setSelectedCampaignId } from "@/lib/campaigns";
import { signOut } from "@/lib/auth";

export async function selectClient(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  if (slug) {
    await setSelectedClientSlug(slug);
    // A campaign belongs to one client: switching client starts at All.
    await setSelectedCampaignId(null);
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/** Scope every page to one campaign (or "" for all). Stays on the current page. */
export async function selectCampaign(formData: FormData) {
  const id = String(formData.get("campaign") ?? "");
  await setSelectedCampaignId(/^[0-9a-f-]{36}$/i.test(id) ? id : null);
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
