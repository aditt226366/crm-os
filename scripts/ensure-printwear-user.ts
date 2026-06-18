import bcrypt from "bcryptjs";
import { Plan, PrismaClient, Role, TenantStatus, UserStatus } from "@prisma/client";

const prisma = new PrismaClient();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const username = requiredEnv("PRINTWEAR_USERNAME");
  const temporaryPassword = requiredEnv("PRINTWEAR_TEMP_PASSWORD");
  const email =
    process.env.PRINTWEAR_EMAIL?.trim() ||
    (username.includes("@") ? username : `${username}@printwear.local`);
  const ownerName = process.env.PRINTWEAR_OWNER_NAME?.trim() || "Printwear Owner";

  const tenant = await prisma.tenant.upsert({
    where: { slug: "printwear" },
    update: {
      name: "Printwear",
      status: TenantStatus.ACTIVE
    },
    create: {
      name: "Printwear",
      slug: "printwear",
      plan: Plan.STARTER,
      status: TenantStatus.ACTIVE
    }
  });

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: "insensitive" } },
        { email: { equals: email, mode: "insensitive" } }
      ]
    }
  });

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          tenantId: tenant.id,
          name: ownerName,
          email,
          username,
          passwordHash,
          role: Role.COMPANY_OWNER,
          status: UserStatus.ACTIVE,
          forcePasswordReset: true
        }
      })
    : await prisma.user.create({
        data: {
          tenantId: tenant.id,
          name: ownerName,
          email,
          username,
          passwordHash,
          role: Role.COMPANY_OWNER,
          status: UserStatus.ACTIVE,
          forcePasswordReset: true
        }
      });

  console.log("Printwear user ready", {
    tenantId: tenant.id,
    userId: user.id,
    username: user.username,
    email: user.email
  });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to ensure Printwear user", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error"
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
