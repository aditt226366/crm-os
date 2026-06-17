import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";
import { INTEGRATION_TYPES } from "@/lib/constants";
import { serializeIntegration } from "@/lib/serializers";
import { defaultMaskedDisplay } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    await Promise.all(
      INTEGRATION_TYPES.map((type) =>
        prisma.integration.upsert({
          where: { tenantId_type: { tenantId: id, type } },
          create: {
            tenantId: id,
            type,
            status: "NOT_CONNECTED",
            maskedDisplay: defaultMaskedDisplay(),
            createdById: admin.id
          },
          update: {}
        })
      )
    );
    const integrations = await prisma.integration.findMany({
      where: { tenantId: id },
      include: { createdBy: true, updatedBy: true },
      orderBy: { type: "asc" }
    });
    return json({ integrations: integrations.map(serializeIntegration) });
  } catch (error) {
    return errorResponse(error);
  }
}
