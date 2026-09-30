import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { findInvite } from "@/lib/client-users";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Set your password" };

/** Where an invited client person chooses their own password (the link is one-time). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const person = await findInvite(token);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy px-4">
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-white">Creator Manager</h1>
          <p className="mt-1 text-sm text-sidebar-muted">
            {person ? `Welcome, ${person.name}. Choose a password to see your creator program.` : "Set your password"}
          </p>
        </div>
        {person ? (
          <InviteForm token={token} email={person.email} />
        ) : (
          <div className="rounded-xl bg-surface p-6 text-sm text-text-muted shadow-float">
            This invite link has expired or was already used. Ask your contact at the agency for a new one, or{" "}
            <Link href="/login" className="font-medium text-accent underline">
              sign in
            </Link>{" "}
            if you already set a password.
          </div>
        )}
      </div>
    </div>
  );
}
