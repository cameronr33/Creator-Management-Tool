"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSelectedClientSlug } from "@/lib/client-cookie";
import { setSelectedCampaignId } from "@/lib/campaigns";
import { setSelectedView } from "@/lib/view-cookie";
import { parseView } from "@/lib/owners";
import { auth, signOut } from "@/lib/auth";

/** Server actions are public endpoints too: the agency's ones refuse a client login. */
async function agencyOnly() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.kind === "client") redirect("/portal");
}

export async function selectClient(formData: FormData) {
  await agencyOnly();
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
  await agencyOnly();
  const id = String(formData.get("campaign") ?? "");
  await setSelectedCampaignId(/^[0-9a-f-]{36}$/i.test(id) ? id : null);
  revalidatePath("/", "layout");
}

/** Mine / Everyone on Today, Pipeline and Creators — remembered, stays on the current page. */
export async function selectView(view: string) {
  await agencyOnly();
  await setSelectedView(parseView(view));
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
