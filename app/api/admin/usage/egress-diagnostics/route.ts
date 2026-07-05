import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { getEgressDiagnostics } from "@/lib/egress";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  try {
    await requirePlatformAdmin(request);
    return json(getEgressDiagnostics(), {
      egress: {
        route: request.nextUrl.pathname,
        tenantId: "platform",
        startedAt
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
