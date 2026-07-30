import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `service: "crm-os"` identifies this app specifically. The hosting platform
// serves its own placeholder page on the same domain when the container is not
// running, and that placeholder also answers /api/health — so the field is how
// you tell "my app is up" from "the platform is answering for it".
const SERVICE = "crm-os";

/**
 * GET /api/health      liveness only — never touches the database, so a database
 *                      blip cannot make the platform mark this app unhealthy.
 * GET /api/health?db=1 also probes the database and reports the failure class.
 *                      Deliberately reports no connection string, host, or
 *                      credentials — only whether it worked and the error code.
 */
export async function GET(request: NextRequest) {
  const base = { ok: true, service: SERVICE };
  if (request.nextUrl.searchParams.get("db") !== "1") {
    return NextResponse.json(base, { status: 200 });
  }

  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasDatabaseUrl) {
    return NextResponse.json(
      { ...base, database: { ok: false, reason: "DATABASE_URL is not set in this environment" } },
      { status: 503 }
    );
  }

  const startedAt = Date.now();
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ...base, database: { ok: true, latencyMs: Date.now() - startedAt } },
      { status: 200 }
    );
  } catch (error) {
    const details = error as { code?: unknown; errorCode?: unknown; message?: unknown };
    const code =
      typeof details.code === "string"
        ? details.code
        : typeof details.errorCode === "string"
          ? details.errorCode
          : null;
    return NextResponse.json(
      {
        ...base,
        database: {
          ok: false,
          latencyMs: Date.now() - startedAt,
          kind: error instanceof Error ? error.name : "UnknownError",
          code,
          // First line only, with any embedded credentials stripped: some Prisma
          // messages quote the connection string, and this endpoint is
          // unauthenticated.
          reason: String(details.message ?? error)
            .split("\n")[0]
            .replace(/\/\/[^@/\s]*@/g, "//***@")
            .slice(0, 200)
        }
      },
      { status: 503 }
    );
  }
}
