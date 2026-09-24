import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { activeClientPerson } from "@/lib/client-session";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  // A client whose login was turned off still holds an old token: show the form, never loop.
  if (session?.user && session.user.kind !== "client") redirect("/");
  if (session?.user && (await activeClientPerson(session))) redirect("/portal");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-navy px-4">
      {/* The soft blue glow from the sentic.io hero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full opacity-60"
        style={{ background: "radial-gradient(closest-side, rgba(75,135,189,0.45), rgba(75,135,189,0) 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-white">Creator Manager</h1>
          <p className="mt-1 text-sm text-sidebar-muted">Sentic&apos;s creator relationship tool</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-sidebar-muted">
          Need a login? Ask the project owner — accounts are created by hand.
        </p>
      </div>
    </div>
  );
}
