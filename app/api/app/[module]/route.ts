import type { NextRequest } from "next/server";

import { errorResponse, json } from "@/lib/api";
import { requireFeature } from "@/lib/guards";
import { FEATURE_DEFINITIONS, routeFeatureKey } from "@/lib/constants";

type Context = { params: Promise<{ module: string }> };

async function handleModuleRequest(request: NextRequest, context: Context) {
  try {
    const { module } = await context.params;
    const featureKey = routeFeatureKey(module);
    if (!featureKey) {
      return json({ error: { code: "NOT_FOUND", message: "Module API not found" } }, { status: 404 });
    }

    const { user } = await requireFeature(request, featureKey);
    const definition = FEATURE_DEFINITIONS[featureKey];

    return json({
      tenantId: user.tenantId,
      featureKey,
      module: definition.navLabel,
      status: "ENABLED"
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest, context: Context) {
  return handleModuleRequest(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  return handleModuleRequest(request, context);
}

export async function PATCH(request: NextRequest, context: Context) {
  return handleModuleRequest(request, context);
}

export async function DELETE(request: NextRequest, context: Context) {
  return handleModuleRequest(request, context);
}
