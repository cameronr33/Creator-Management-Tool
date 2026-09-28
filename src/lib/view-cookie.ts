import { cookies } from "next/headers";
import { parseView, type View } from "@/lib/owners";

/** Mine / Everyone, remembered per browser like the client and campaign (Everyone when unset). */
const COOKIE = "cm_view";

export async function getSelectedView(): Promise<View> {
  return parseView((await cookies()).get(COOKIE)?.value);
}

export async function setSelectedView(view: View): Promise<void> {
  const store = await cookies();
  if (view === "all") store.delete(COOKIE);
  else store.set(COOKIE, view, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
