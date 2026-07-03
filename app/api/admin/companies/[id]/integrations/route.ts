import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/guards";
import { ApiError } from "@/lib/api";
import { integrationErrorResponse, integrationSuccess } from "@/lib/integrations/responses";
import { INTEGRATION_TYPES } from "@/lib/constants";
import { serializeIntegration } from "@/lib/serializers";
import { ensureIntegrationSchema } from "@/lib/integration-schema";
import { defaultMaskedDisplay } from "@/lib/integration-vault";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  let companyId = "unknown";
  let includeDebug = false;
  try {
    const admin = await requirePlatformAdmin(request);
    includeDebug = admin.role === "PLATFORM_ADMIN";
    const { id } = await context.params;
    companyId = id;
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }
    await ensureIntegrationSchema();
    await Promise.all(
      INTEGRATION_TYPES.map((type) =>
        prisma.integration.upsert({
          where: { tenantId_type: { tenantId: id, type } },
          create: {
            tenantId: id,
            type,
            status: "NOT_CONNECTED",
            maskedDisplay: defaultMaskedDisplay(),
            createdById: admin.id,
            updatedById: admin.id
          },
          update: {}
        })
      )
    );
    const integrations = await prisma.integration.findMany({
      where: { tenantId: id },
      orderBy: { type: "asc" }
    });
    return integrationSuccess({
      message: "Integrations loaded",
      integrations: integrations.map(serializeIntegration)
    });
  } catch (error) {
    return integrationErrorResponse(error, {
      route: request.nextUrl.pathname,
      companyId,
      includeDebug
    });
  }
}
