"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle } from "lucide-react";
import { Button, Callout, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError("That email and password don't match.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-pop">
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      {error && (
        <Callout tone="bad" icon={<AlertCircle size={15} />}>
          {error}
        </Callout>
      )}
      <Button type="submit" variant="primary" pending={pending} className="mt-1 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
