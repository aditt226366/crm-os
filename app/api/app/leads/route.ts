import { NextRequest } from "next/server";
import { z } from "zod";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { leadFlowSummary, runGoogleSheetLeadFlow } from "@/lib/lead-flow";

const leadFlowSchema = z.object({
  templateId: z.string().trim().min(1).optional().or(z.literal("")),
  range: z.string().trim().min(1).max(80).optional().or(z.literal("")),
  maxRows: z.coerce.number().int().min(1).max(200).optional()
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "LEAD_MANAGEMENT");
    return json(await leadFlowSummary(user.tenantId!));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "LEAD_MANAGEMENT");
    const body = leadFlowSchema.parse(await request.json().catch(() => ({})));
    const result = await runGoogleSheetLeadFlow({
      tenantId: user.tenantId!,
      userId: user.id,
      templateId: body.templateId || undefined,
      range: body.range || undefined,
      maxRows: body.maxRows
    });
    const summary = await leadFlowSummary(user.tenantId!);

    return json({ ok: true, result, ...summary });
  } catch (error) {
    return errorResponse(error);
  }
}
