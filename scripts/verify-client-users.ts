/**
 * Verifies client team members and their invites.
 *
 *   npm run preview:verify -- scripts/verify-client-users.ts
 *
 * An invite link works once and only before it expires; only its hash is
 * stored; the person's password is theirs (hashed); turning a login off stops
 * it; nobody can be put on two teams, or be an agency login and a client one;
 * and one client can't touch another client's people.
 */
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { db, schema } from "./db";
import { acceptInvite, addClientUser, createInvite, findInvite, hashInviteToken, removeClientUser, revokeLogin } from "../src/lib/client-users";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [client] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.slug, "hella")).limit(1);
  const [other] = await db.insert(schema.clients).values({ name: "__verify_cu_other", slug: `__verify_cu_${Date.now()}` }).returning();
  const email = `__verify_cu_${Date.now()}@brand.example`;
  let id = "";
  try {
    const added = await addClientUser(client.id, "Verify Person", email.toUpperCase());
    check("a person is added, their address lowercased", added.ok);
    if (!added.ok) return;
    id = added.id;
    const [row0] = await db.select().from(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, id));
    check("…as an email contact with no login yet", row0.email === email && !row0.loginEnabled && !row0.passwordHash);
    check("the same person can't be on two teams", !(await addClientUser(other.id, "Twice", email)).ok);
    const [agency] = await db.select({ email: schema.users.email }).from(schema.users).limit(1);
    check("an agency login can't also be a client person", !!agency && !(await addClientUser(client.id, "Agency", agency.email)).ok);

    check("another client can't invite them", (await createInvite(other.id, id)) === null);
    const token = (await createInvite(client.id, id))!;
    const [row1] = await db.select().from(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, id));
    check("only the invite's hash is stored, never the link itself", row1.inviteTokenHash === hashInviteToken(token) && row1.inviteTokenHash !== token);
    check("the link finds them", (await findInvite(token))?.id === id);
    check("an expired link doesn't", (await findInvite(token, new Date(Date.now() + 8 * 86_400_000))) === null);
    check("a too-short password is refused", !(await acceptInvite(token, "short")).ok);
    const accepted = await acceptInvite(token, "a long enough secret");
    const [row2] = await db.select().from(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, id));
    check("setting a password turns their login on", accepted.ok && row2.loginEnabled && !!row2.passwordHash);
    check("…stored as a hash that checks out", !!row2.passwordHash && row2.passwordHash !== "a long enough secret" && (await compare("a long enough secret", row2.passwordHash)));
    check("the link works only once", !(await acceptInvite(token, "another long secret")).ok && row2.inviteTokenHash === null);
    const second = (await createInvite(client.id, id))!;
    const third = (await createInvite(client.id, id))!;
    check("a new link replaces the old one", (await findInvite(second)) === null && (await findInvite(third))?.id === id);

    check("another client can't turn their login off", !(await revokeLogin(other.id, id)));
    await revokeLogin(client.id, id);
    const [row3] = await db.select().from(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, id));
    check("turning the login off clears the password and any open link", !row3.loginEnabled && !row3.passwordHash && !row3.inviteTokenHash && (await findInvite(third)) === null);
    check("another client can't remove them", !(await removeClientUser(other.id, id)));
    check("their own client can", await removeClientUser(client.id, id));
    id = "";
  } finally {
    if (id) await db.delete(schema.cmClientUsers).where(eq(schema.cmClientUsers.id, id));
    await db.delete(schema.clients).where(eq(schema.clients.id, other.id));
  }
  check("test rows cleaned up", (await db.select().from(schema.cmClientUsers).where(eq(schema.cmClientUsers.email, email))).length === 0);
}

main().then(
  () => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
