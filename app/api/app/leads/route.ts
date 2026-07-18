import { NextRequest } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { leadFlowSummary } from "@/lib/lead-flow";
import { runGoogleSheetLeadFlowWithTenantLock } from "@/lib/lead-sheet-auto-sync";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, invalidateTenantEgressCaches, parseBoundedLimit } from "@/lib/egress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const leadFlowSchema = z.object({
  range: z.string().trim().min(1).max(80).optional().or(z.literal("")),
  maxRows: z.coerce.number().int().min(1).max(200).default(200)
});

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { user } = await requireFeature(request, "LEAD_MANAGEMENT");
    const tenantId = user.tenantId!;
    const { searchParams } = request.nextUrl;
    const limit = parseBoundedLimit({
      searchParams,
      defaultLimit: DEFAULT_LIST_LIMIT,
      maxLimit: MAX_LIST_LIMIT
    });
    const payload = await leadFlowSummary(tenantId, {
      limit,
      cursor: searchParams.get("cursor"),
      search: searchParams.get("search") ?? searchParams.get("q"),
      status: searchParams.get("status"),
      leadTemperature: searchParams.get("leadTemperature") ?? searchParams.get("temperature"),
      source: searchParams.get("source")
    });
    return json(payload, { egress: { route: request.nextUrl.pathname, tenantId, startedAt } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { user } = await requireFeature(request, "LEAD_MANAGEMENT");
    const tenantId = user.tenantId!;
    const body = leadFlowSchema.parse(await request.json().catch(() => ({})));
    // Manual "Import Leads & Send Template": wait briefly if the background
    // scheduler holds the lock (instead of hard-failing), and force-retry FAILED
    // leads immediately so a resend after fixing the token isn't blocked by the
    // background retry cooldown.
    const result = await runGoogleSheetLeadFlowWithTenantLock(
      {
        tenantId,
        userId: user.id,
        maxRows: body.maxRows,
        forceRetryFailed: true
      },
      { waitForLockMs: 15000 }
    );
    invalidateTenantEgressCaches(tenantId);
    const summary = await leadFlowSummary(tenantId);

    return json({ ok: true, result, ...summary }, { egress: { route: request.nextUrl.pathname, tenantId, startedAt } });
  } catch (error) {
    return errorResponse(error);
  }
}
