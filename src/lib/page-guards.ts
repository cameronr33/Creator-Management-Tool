import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * The agency's guard for pages. Every page under (app) calls it itself: a
 * layout's check isn't enough, because Next can render a page on its own
 * (a client navigation that says the layout is already mounted) — Next's own
 * auth guide warns against relying on layouts (security review, 2026-09-24).
 * verify-access asserts every agency page calls this.
 */
export async function requireAgencyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.kind === "client") redirect("/portal");
  return session;
}
