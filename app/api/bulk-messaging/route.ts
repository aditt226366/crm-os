import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { requireConnectedIntegration } from "@/lib/integration-requirements";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "BULK_MESSAGING");
    await requireConnectedIntegration(user.tenantId!, "WHATSAPP_CLOUD", "WhatsApp Cloud API is not connected for this company.");
    await requireConnectedIntegration(
      user.tenantId!,
      "WHATSAPP_TEMPLATE_SETTINGS",
      "WhatsApp template settings are not configured for this company."
    );
    return json({ ok: true, module: "BULK_MESSAGING", message: "Bulk messaging API foundation ready." });
  } catch (error) {
    return errorResponse(error);
  }
}
