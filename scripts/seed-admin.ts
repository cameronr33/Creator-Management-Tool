/**
 * Creates or promotes the agency admin user (shared `users` table).
 *
 * Usage: npm run db:seed
 * Reads ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME from .env.local.
 */
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME ?? "Admin";

if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local");
  process.exit(1);
}
if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}

async function main() {
  const [existing] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, email!))
    .limit(1);

  if (existing) {
    if (existing.role !== "admin") {
      await db
        .update(schema.users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(schema.users.email, email!));
      console.log(`Promoted ${email} to admin.`);
    } else {
      console.log(`Admin already exists for ${email} — nothing to do.`);
    }
    return;
  }

  const passwordHash = await hash(password!, 12);
  await db.insert(schema.users).values({
    name,
    email: email!,
    passwordHash,
    role: "admin",
  });
  console.log(`Created admin user ${email}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
