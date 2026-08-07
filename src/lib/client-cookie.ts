import { cookies } from "next/headers";

const COOKIE = "cm_client";

/** The client slug the user last selected, if any. */
export async function getSelectedClientSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

export async function setSelectedClientSlug(slug: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
