"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle } from "lucide-react";
import { Button, Callout, Field, Input } from "@/components/ui";

const MIN = 10;

export function InviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (password !== String(form.get("confirm"))) return setError("The two passwords don't match.");
    setPending(true);
    const res = await fetch("/api/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setPending(false);
      return setError(data.error ?? "Couldn't set your password — try the link again.");
    }
    const signedIn = await signIn("credentials", { email, password, redirect: false });
    setPending(false);
    router.push(signedIn?.error ? "/login" : "/portal");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-pop">
      <Field label="Email">
        <Input value={email} readOnly autoComplete="username" />
      </Field>
      <Field label="Choose a password" hint={`At least ${MIN} characters.`}>
        <Input name="password" type="password" required autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Type it again">
        <Input name="confirm" type="password" required autoComplete="new-password" />
      </Field>
      {error && (
        <Callout tone="bad" icon={<AlertCircle size={15} />}>
          {error}
        </Callout>
      )}
      <Button type="submit" variant="primary" pending={pending} className="mt-1 w-full">
        {pending ? "Saving…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
