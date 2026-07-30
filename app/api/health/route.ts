import { NextRequest, NextResponse } from "next/server";
import { databaseEnvCheck } from "@/lib/db-env";

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

  const raw = process.env.DATABASE_URL ?? "";
  if (!raw.trim()) {
    return NextResponse.json(
      { ...base, database: { ok: false, reason: "DATABASE_URL is not set in this environment" } },
      { status: 503 }
    );
  }

  // Shape of the configured URL, with no credentials. Prisma rejects a malformed
  // connection string at client init in ~1ms without opening a socket, and its
  // message alone does not say *how* it was malformed — these flags do. A stray
  // wrapping quote or a value truncated at "&" both show up clearly here.
  const url = { ...databaseEnvCheck(), parses: false, protocol: null as string | null, port: null as string | null, params: [] as string[] };
  try {
    const parsed = new URL(raw.trim());
    url.parses = true;
    url.protocol = parsed.protocol;
    url.port = parsed.port || null;
    url.params = [...parsed.searchParams.keys()];
  } catch {
    url.parses = false;
  }
  const looksWrapped = /^["']|["']$/.test(raw.trim());

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
          // First NON-EMPTY line: Prisma prefixes these messages with newlines.
          // Credentials stripped — this endpoint is unauthenticated.
          reason:
            String(details.message ?? error)
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 3)
              .join(" | ")
              .replace(/\/\/[^@/\s]*@/g, "//***@")
              .slice(0, 400) || "(no message)",
          url: { ...url, looksWrapped }
        }
      },
      { status: 503 }
    );
  }
}
