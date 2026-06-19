import { PrismaClient } from "@prisma/client";

function prismaDatabaseUrl() {
  return process.env.DATABASE_URL?.replace(/sslmode=require/g, "sslmode=disable");
}

const prisma = new PrismaClient({
  datasources: prismaDatabaseUrl() ? { db: { url: prismaDatabaseUrl()! } } : undefined
});
const username = process.env.PRINTWEAR_USERNAME?.trim() || "Printwear@xyz";

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive"
      }
    },
    select: {
      id: true,
      username: true,
      role: true,
      tenantId: true,
      passwordHash: true,
      status: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true
        }
      }
    }
  });

  if (!user) {
    console.log("Printwear user check", {
      username,
      exists: false,
      action: "Create/update this user through the Admin Panel or seed script."
    });
    return;
  }

  console.log("Printwear user check", {
    username: user.username,
    exists: true,
    role: user.role,
    isCompanyOwner: user.role === "COMPANY_OWNER",
    userStatus: user.status,
    tenantIdExists: Boolean(user.tenantId),
    tenantStatus: user.tenant?.status ?? null,
    tenantActive: user.tenant?.status === "ACTIVE",
    passwordHashExists: Boolean(user.passwordHash),
    tenant: user.tenant
      ? {
          id: user.tenant.id,
          name: user.tenant.name,
          slug: user.tenant.slug
        }
      : null
  });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to check Printwear user", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error"
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
