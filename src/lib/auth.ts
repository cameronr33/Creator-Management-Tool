import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmClientUsers, users } from "@/lib/db/schema";
import { getPreviewAuthCookies } from "@/lib/auth-cookies";
import { passwordVersion } from "@/lib/client-session";

/** Compared against when no account matches, so a miss takes as long as a hit (no email probing by timing). */
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.Wf2V7d0oP8QJ5gtJ3Bv1JmS7wYfK";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  cookies: getPreviewAuthCookies(process.env.CREATOR_LOCAL_PREVIEW),
  // Auth.js v5 disables host trust in production by default. We sit behind
  // Railway's edge proxy, so the request arrives with X-Forwarded-Host set
  // to the public domain — trust it explicitly or every /api/auth/* call
  // returns "UntrustedHost" and the login page shows a generic config error.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (user) {
          const isValid = await compare(password, user.passwordHash);
          if (!isValid) return null;
          return { id: user.id, name: user.name, email: user.email, role: user.role, kind: "agency" as const, clientId: null };
        }

        // Someone at a client: only once invited and their password is set.
        const [person] = await db
          .select()
          .from(cmClientUsers)
          .where(and(eq(cmClientUsers.email, email.trim().toLowerCase()), eq(cmClientUsers.loginEnabled, true)))
          .limit(1);
        if (!person?.passwordHash) {
          await compare(password, DUMMY_HASH);
          return null;
        }
        if (!(await compare(password, person.passwordHash))) return null;
        await db.update(cmClientUsers).set({ lastLoginAt: sql`now()` }).where(eq(cmClientUsers.id, person.id));
        return { id: person.id, name: person.name, email: person.email, role: "client", kind: "client" as const, clientId: person.clientId, pwv: passwordVersion(person.passwordHash) };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.name = user.name ?? null;
        token.email = user.email ?? null;
        const u = user as { role: string; kind?: "agency" | "client"; clientId?: string | null; pwv?: string };
        token.role = u.role;
        token.kind = u.kind ?? "agency";
        token.clientId = u.clientId ?? null;
        token.pwv = u.pwv ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.kind = token.kind ?? "agency";
      session.user.clientId = token.clientId ?? null;
      session.user.pwv = token.pwv ?? null;
      return session;
    },
  },
});
