import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { requireConnectedIntegration } from "@/lib/integration-requirements";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "AI_WORKFLOW_BUILDER");
    await requireConnectedIntegration(user.tenantId!, "AI_MODEL", "AI model is not connected for this company.");
    return json({ ok: true, module: "AI_WORKFLOW_BUILDER", message: "Workflow API foundation ready." });
  } catch (error) {
    return errorResponse(error);
  }
}
