"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSelectedClientSlug } from "@/lib/client-cookie";
import { signOut } from "@/lib/auth";

export async function selectClient(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  if (slug) await setSelectedClientSlug(slug);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
