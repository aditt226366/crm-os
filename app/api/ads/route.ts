import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getIntegrationState } from "@/lib/integration-requirements";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "ADS");
    const metaAds = await getIntegrationState(user.tenantId!, "META_ADS");
    return json({
      ok: true,
      module: "ADS",
      canSaveDraft: true,
      canPublishLiveCampaigns: metaAds?.status === "CONNECTED",
      message: metaAds?.status === "CONNECTED" ? "Ads API foundation ready." : "Connect Meta Ads integration to publish."
    });
  } catch (error) {
    return errorResponse(error);
  }
}
