import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireFeature(request, "TEMPLATES");
    const templates = await prisma.whatsAppTemplate.findMany({
      where: { tenantId: user.tenantId! },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });

    return json({
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        category: template.category,
        language: template.language,
        status: template.status,
        body: template.body,
        variables: template.variables,
        updatedAt: template.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}
