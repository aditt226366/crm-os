/**
 * Creates (or refreshes) a single PLATFORM_ADMIN user from the
 * PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD env vars.
 *
 * Idempotent: if the admin already exists it re-hashes the password and
 * ensures the account is ACTIVE with the PLATFORM_ADMIN role. It does NOT
 * seed demo companies — use `npm run db:seed` for that.
 *
 *   npm run admin:create
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/security";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be set in .env before running this script."
    );
  }
  if (password.length < 8) {
    throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      name: "Platform Admin",
      email,
      username: email,
      passwordHash,
      role: "PLATFORM_ADMIN",
      status: "ACTIVE"
    },
    update: {
      passwordHash,
      role: "PLATFORM_ADMIN",
      status: "ACTIVE"
    }
  });

  console.log("\n" + (existing ? "✅ Existing admin updated" : "✅ New platform admin created"));
  console.log("   Email/username: " + admin.email);
  console.log("   Password:       " + password);
  console.log("   Role:           PLATFORM_ADMIN");
  console.log("   Sign in at:     /login  → redirects to /admin\n");
}

main()
  .catch((error) => {
    console.error("\n❌ Could not create admin:\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
