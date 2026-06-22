import { NextRequest } from "next/server";
import { ApiError, errorResponse, json } from "@/lib/api";
import {
  leadSheetAutoSyncStatus,
  runDueGoogleSheetLeadFlows,
  startLeadSheetAutoSyncScheduler
} from "@/lib/lead-sheet-auto-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get("x-cron-secret")?.trim() || request.nextUrl.searchParams.get("secret")?.trim();
}

function assertCronAuthorized(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new ApiError(403, "CRON_SECRET_REQUIRED", "Set CRON_SECRET before enabling the lead Sheet cron endpoint.");
  }

  if (configuredSecret && bearerToken(request) !== configuredSecret) {
    throw new ApiError(401, "CRON_UNAUTHORIZED", "Invalid cron secret.");
  }
}

function maxRowsParam(request: NextRequest) {
  const value = Number(request.nextUrl.searchParams.get("maxRows"));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.max(Math.round(value), 1), 200);
}

async function run(request: NextRequest) {
  assertCronAuthorized(request);
  startLeadSheetAutoSyncScheduler();

  if (request.nextUrl.searchParams.get("status") === "1") {
    return json({ ok: true, status: leadSheetAutoSyncStatus() });
  }

  const summary = await runDueGoogleSheetLeadFlows({
    trigger: "cron",
    tenantId: request.nextUrl.searchParams.get("tenantId")?.trim() || undefined,
    range: request.nextUrl.searchParams.get("range")?.trim() || undefined,
    maxRows: maxRowsParam(request)
  });

  return json({ ok: true, status: leadSheetAutoSyncStatus(), summary });
}

export async function GET(request: NextRequest) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request);
  } catch (error) {
    return errorResponse(error);
  }
}
