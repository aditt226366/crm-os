import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/security";

let authSchemaReady = false;
let authSchemaPromise: Promise<void> | null = null;

type ExistsRow = {
  exists: boolean;
};

async function tableExists(tableName: string) {
  const rows = await prisma.$queryRaw<ExistsRow[]>`
    SELECT to_regclass(${`public."${tableName}"`}) IS NOT NULL AS "exists";
  `;
  return Boolean(rows[0]?.exists);
}

async function authSchemaNeedsRepair() {
  const [tenantExists, userExists, refreshTokenExists] = await Promise.all([
    tableExists("Tenant"),
    tableExists("User"),
    tableExists("RefreshToken")
  ]);

  if (!tenantExists || !userExists || !refreshTokenExists) {
    return true;
  }

  const rows = await prisma.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name IN ('Tenant', 'User', 'RefreshToken');
  `;

  const columns = new Set(rows.map((row) => `${row.tableName}.${row.columnName}`));
  const requiredColumns = [
    "Tenant.id",
    "Tenant.name",
    "Tenant.slug",
    "Tenant.status",
    "Tenant.plan",
    "Tenant.createdAt",
    "Tenant.updatedAt",
    "Tenant.deactivatedAt",
    "User.id",
    "User.tenantId",
    "User.name",
    "User.email",
    "User.username",
    "User.passwordHash",
    "User.role",
    "User.status",
    "User.lastLoginAt",
    "User.forcePasswordReset",
    "User.createdAt",
    "User.updatedAt",
    "RefreshToken.id",
    "RefreshToken.userId",
    "RefreshToken.tokenHash",
    "RefreshToken.expiresAt",
    "RefreshToken.revokedAt",
    "RefreshToken.createdAt"
  ];

  return requiredColumns.some((column) => !columns.has(column));
}

const authRepairStatements = [
  `DO $$
BEGIN
  CREATE TYPE public."Role" AS ENUM (
    'PLATFORM_ADMIN',
    'COMPANY_OWNER',
    'COMPANY_AGENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';`,
  `ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'COMPANY_OWNER';`,
  `ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'COMPANY_AGENT';`,
  `DO $$
BEGIN
  CREATE TYPE public."TenantStatus" AS ENUM (
    'ACTIVE',
    'DEACTIVATED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."TenantStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';`,
  `ALTER TYPE public."TenantStatus" ADD VALUE IF NOT EXISTS 'DEACTIVATED';`,
  `DO $$
BEGIN
  CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'DEACTIVATED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."UserStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';`,
  `ALTER TYPE public."UserStatus" ADD VALUE IF NOT EXISTS 'DEACTIVATED';`,
  `DO $$
BEGIN
  CREATE TYPE public."Plan" AS ENUM (
    'STARTER',
    'PRO',
    'ENTERPRISE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`,
  `ALTER TYPE public."Plan" ADD VALUE IF NOT EXISTS 'STARTER';`,
  `ALTER TYPE public."Plan" ADD VALUE IF NOT EXISTS 'PRO';`,
  `ALTER TYPE public."Plan" ADD VALUE IF NOT EXISTS 'ENTERPRISE';`,
  `CREATE TABLE IF NOT EXISTS public."Tenant" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" public."TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "plan" public."Plan" NOT NULL DEFAULT 'STARTER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMP(3)
);`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "slug" TEXT;`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "status" public."TenantStatus" DEFAULT 'ACTIVE';`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "plan" public."Plan" DEFAULT 'STARTER';`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."Tenant" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);`,
  `UPDATE public."Tenant" SET "status" = 'ACTIVE'::public."TenantStatus" WHERE "status" IS NULL;`,
  `UPDATE public."Tenant" SET "plan" = 'STARTER'::public."Plan" WHERE "plan" IS NULL;`,
  `UPDATE public."Tenant" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."Tenant" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON public."Tenant"("slug");`,
  `CREATE TABLE IF NOT EXISTS public."User" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" public."Role" NOT NULL,
  "status" public."UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" TIMESTAMP(3),
  "forcePasswordReset" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "name" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "email" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "username" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "role" public."Role";`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "status" public."UserStatus" DEFAULT 'ACTIVE';`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "forcePasswordReset" BOOLEAN DEFAULT false;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."User" SET "status" = 'ACTIVE'::public."UserStatus" WHERE "status" IS NULL;`,
  `UPDATE public."User" SET "forcePasswordReset" = false WHERE "forcePasswordReset" IS NULL;`,
  `UPDATE public."User" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `UPDATE public."User" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON public."User"("email");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON public."User"("username");`,
  `CREATE INDEX IF NOT EXISTS "User_tenantId_idx" ON public."User"("tenantId");`,
  `CREATE INDEX IF NOT EXISTS "User_role_idx" ON public."User"("role");`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_tenantId_fkey'
  ) THEN
    ALTER TABLE public."User"
    ADD CONSTRAINT "User_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS public."RefreshToken" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "userId" TEXT;`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);`,
  `ALTER TABLE public."RefreshToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`,
  `UPDATE public."RefreshToken" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key" ON public."RefreshToken"("tokenHash");`,
  `CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON public."RefreshToken"("userId");`,
  `CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON public."RefreshToken"("expiresAt");`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RefreshToken_userId_fkey'
  ) THEN
    ALTER TABLE public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;`
];

function configuredPlatformAdmin() {
  return {
    email: process.env.PLATFORM_ADMIN_EMAIL?.replace(/^"|"$/g, "").trim() || "admin@example.com",
    password: process.env.PLATFORM_ADMIN_PASSWORD?.replace(/^"|"$/g, "").trim() || "ChangeMe123!"
  };
}

function configuredPrintwearOwner() {
  const username = process.env.PRINTWEAR_USERNAME?.trim() || "Printwear@xyz";
  const email =
    process.env.PRINTWEAR_EMAIL?.trim() ||
    (username.includes("@") ? username : `${username}@printwear.local`);

  return {
    username,
    email,
    password:
      process.env.PRINTWEAR_TEMP_PASSWORD?.trim() ||
      process.env.PRINTWEAR_PASSWORD?.trim() ||
      "Printwear@123",
    name: process.env.PRINTWEAR_OWNER_NAME?.trim() || "Printwear Owner"
  };
}

async function seedAuthUsers() {
  const admin = configuredPlatformAdmin();
  const printwear = configuredPrintwearOwner();
  const adminPasswordHash = await hashPassword(admin.password);
  const printwearPasswordHash = await hashPassword(printwear.password);

  await prisma.$executeRaw`
    UPDATE public."Tenant"
    SET
      "name" = 'Printwear',
      "status" = 'ACTIVE'::public."TenantStatus",
      "updatedAt" = NOW()
    WHERE LOWER("slug") = 'printwear'
    OR LOWER("name") = 'printwear';
  `;

  await prisma.$executeRaw`
    INSERT INTO public."Tenant" (
      "id",
      "name",
      "slug",
      "status",
      "plan",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'tenant_printwear',
      'Printwear',
      'printwear',
      'ACTIVE'::public."TenantStatus",
      'STARTER'::public."Plan",
      NOW(),
      NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM public."Tenant"
      WHERE LOWER("slug") = 'printwear'
      OR LOWER("name") = 'printwear'
    )
    ON CONFLICT ("slug") DO UPDATE
    SET
      "name" = EXCLUDED."name",
      "status" = 'ACTIVE'::public."TenantStatus",
      "updatedAt" = NOW();
  `;

  await prisma.$executeRaw`
    INSERT INTO public."User" (
      "id",
      "tenantId",
      "name",
      "email",
      "username",
      "passwordHash",
      "role",
      "status",
      "forcePasswordReset",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'user_platform_admin',
      NULL,
      'Platform Admin',
      ${admin.email},
      ${admin.email},
      ${adminPasswordHash},
      'PLATFORM_ADMIN'::public."Role",
      'ACTIVE'::public."UserStatus",
      false,
      NOW(),
      NOW()
    )
    ON CONFLICT ("email") DO UPDATE
    SET
      "name" = EXCLUDED."name",
      "username" = EXCLUDED."username",
      "passwordHash" = EXCLUDED."passwordHash",
      "role" = 'PLATFORM_ADMIN'::public."Role",
      "status" = 'ACTIVE'::public."UserStatus",
      "tenantId" = NULL,
      "updatedAt" = NOW();
  `;

  await prisma.$executeRaw`
    INSERT INTO public."User" (
      "id",
      "tenantId",
      "name",
      "email",
      "username",
      "passwordHash",
      "role",
      "status",
      "forcePasswordReset",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'user_printwear_owner',
      (
        SELECT "id"
        FROM public."Tenant"
        WHERE LOWER("slug") = 'printwear'
        OR LOWER("name") = 'printwear'
        ORDER BY "createdAt" ASC
        LIMIT 1
      ),
      ${printwear.name},
      ${printwear.email},
      ${printwear.username},
      ${printwearPasswordHash},
      'COMPANY_OWNER'::public."Role",
      'ACTIVE'::public."UserStatus",
      false,
      NOW(),
      NOW()
    )
    ON CONFLICT ("email") DO UPDATE
    SET
      "tenantId" = (
        SELECT "id"
        FROM public."Tenant"
        WHERE LOWER("slug") = 'printwear'
        OR LOWER("name") = 'printwear'
        ORDER BY "createdAt" ASC
        LIMIT 1
      ),
      "name" = EXCLUDED."name",
      "username" = EXCLUDED."username",
      "passwordHash" = EXCLUDED."passwordHash",
      "role" = 'COMPANY_OWNER'::public."Role",
      "status" = 'ACTIVE'::public."UserStatus",
      "forcePasswordReset" = false,
      "updatedAt" = NOW();
  `;
}

export async function repairAuthSchema() {
  for (const statement of authRepairStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  await seedAuthUsers();
  authSchemaReady = !(await authSchemaNeedsRepair());
}

export async function ensureAuthSchema() {
  if (authSchemaReady) return;

  authSchemaPromise ??= (async () => {
    if (await authSchemaNeedsRepair()) {
      console.warn("[auth.schema] repairing auth tables");
      await repairAuthSchema();
    }

    authSchemaReady = true;
  })().finally(() => {
    authSchemaPromise = null;
  });

  await authSchemaPromise;
}
