import bcrypt from "bcryptjs";
import { Plan, PrismaClient, Role, TenantStatus, UserStatus } from "@prisma/client";

function prismaDatabaseUrl() {
  return process.env.DATABASE_URL?.replace(/sslmode=require/g, "sslmode=disable");
}

const prisma = new PrismaClient({
  datasources: prismaDatabaseUrl() ? { db: { url: prismaDatabaseUrl()! } } : undefined
});

function requiredEnv(name: string) {
  const fallback =
    name === "PRINTWEAR_USERNAME"
      ? "Printwear@xyz"
      : name === "PRINTWEAR_TEMP_PASSWORD"
        ? "Printwear@123"
        : undefined;
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function findExistingPrintwearTenant() {
  return prisma.tenant.findFirst({
    where: {
      OR: [
        { slug: { equals: "printwear", mode: "insensitive" } },
        { name: { equals: "Printwear", mode: "insensitive" } }
      ]
    },
    orderBy: { createdAt: "asc" }
  });
}

async function main() {
  const username = requiredEnv("PRINTWEAR_USERNAME");
  const temporaryPassword = requiredEnv("PRINTWEAR_TEMP_PASSWORD");
  const email =
    process.env.PRINTWEAR_EMAIL?.trim() ||
    (username.includes("@") ? username : `${username}@printwear.local`);
  const ownerName = process.env.PRINTWEAR_OWNER_NAME?.trim() || "Printwear Owner";

  const existingPrintwearTenant = await findExistingPrintwearTenant();
  const tenant = existingPrintwearTenant
    ? await prisma.tenant.update({
        where: { id: existingPrintwearTenant.id },
        data: {
          name: "Printwear",
          status: TenantStatus.ACTIVE
        }
      })
    : await prisma.tenant.create({
        data: {
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
          forcePasswordReset: false
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
          forcePasswordReset: false
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
