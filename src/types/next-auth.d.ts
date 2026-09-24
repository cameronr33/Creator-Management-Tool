import { DefaultSession } from "next-auth";
import { JWT as DefaultJWT } from "next-auth/jwt";

/**
 * Two kinds of login. "agency" — the shared `users` table, the whole tool.
 * "client" — a person at a brand (cm_client_users), only their brand's
 * portal. A session from before this existed has no kind and is agency.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      kind?: "agency" | "client";
      /** Client logins only: the one brand they may see. */
      clientId?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: string;
    kind?: "agency" | "client";
    clientId?: string | null;
  }
}
