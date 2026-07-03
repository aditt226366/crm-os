import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, json } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/guards";
import { publicSecretEnvNames } from "@/lib/env-security";

type PublicTableRow = {
  schemaName: string;
  tableName: string;
  rlsEnabled: boolean;
  forceRls: boolean;
};

type PublicGrantRow = {
  schemaName: string;
  tableName: string;
  grantee: "anon" | "authenticated";
  privilege: string;
};

function groupedRoleGrants(grants: PublicGrantRow[], grantee: "anon" | "authenticated") {
  const tables = new Map<string, Set<string>>();

  grants
    .filter((grant) => grant.grantee === grantee)
    .forEach((grant) => {
      const key = `${grant.schemaName}.${grant.tableName}`;
      const privileges = tables.get(key) ?? new Set<string>();
      privileges.add(grant.privilege);
      tables.set(key, privileges);
    });

  return {
    grantee,
    hasGrants: tables.size > 0,
    tables: Array.from(tables.entries()).map(([table, privileges]) => ({
      table,
      privileges: Array.from(privileges).sort()
    }))
  };
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);

    const [tables, grants] = await Promise.all([
      prisma.$queryRaw<PublicTableRow[]>`
        SELECT
          n.nspname AS "schemaName",
          c.relname AS "tableName",
          c.relrowsecurity AS "rlsEnabled",
          c.relforcerowsecurity AS "forceRls"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        ORDER BY c.relname ASC;
      `,
      prisma.$queryRaw<PublicGrantRow[]>`
        SELECT
          table_schema AS "schemaName",
          table_name AS "tableName",
          grantee,
          privilege_type AS "privilege"
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND grantee IN ('anon', 'authenticated')
        ORDER BY table_name ASC, grantee ASC, privilege_type ASC;
      `
    ]);

    const rlsDisabledTables = tables
      .filter((table) => !table.rlsEnabled)
      .map((table) => ({
        schema: table.schemaName,
        table: table.tableName,
        rlsEnabled: table.rlsEnabled,
        forceRls: table.forceRls
      }));
    const roleGrants = [
      groupedRoleGrants(grants, "anon"),
      groupedRoleGrants(grants, "authenticated")
    ];

    return json({
      ok: true,
      checkedAt: new Date().toISOString(),
      note: "Diagnostic returns metadata only. It does not expose database URLs, service-role keys, JWT secrets, encryption keys, or API tokens.",
      publicSecretEnvNames: publicSecretEnvNames(),
      publicTables: tables.map((table) => ({
        schema: table.schemaName,
        table: table.tableName,
        rlsEnabled: table.rlsEnabled,
        forceRls: table.forceRls
      })),
      rlsDisabledTables,
      hasRlsDisabledTables: rlsDisabledTables.length > 0,
      roleGrants,
      hasAnonOrAuthenticatedGrants: roleGrants.some((role) => role.hasGrants)
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }

    const details = error as { code?: unknown; name?: unknown };
    console.error("[admin.security.supabase-rls] failed", {
      name: typeof details.name === "string" ? details.name : "UnknownError",
      code: typeof details.code === "string" ? details.code : undefined
    });

    return json(
      {
        error: {
          code: "SUPABASE_RLS_DIAGNOSTIC_FAILED",
          message: "Unable to inspect Supabase RLS metadata."
        }
      },
      { status: 500 }
    );
  }
}
