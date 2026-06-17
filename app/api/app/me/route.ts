import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const user = await requireActiveTenant(request);
    const whatsappIntegration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: user.tenantId!,
          type: "WHATSAPP_CLOUD"
        }
      }
    });
    const metadata = whatsappIntegration?.metadata as { connectedPhoneNumber?: string; connectedPhoneName?: string } | null;
    return json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              slug: user.tenant.slug,
              plan: user.tenant.plan,
              status: user.tenant.status
            }
          : null,
        whatsapp: {
          status: whatsappIntegration?.status ?? "NOT_CONNECTED",
          phoneNumber: metadata?.connectedPhoneNumber ?? null,
          lastVerifiedAt: whatsappIntegration?.lastVerifiedAt?.toISOString() ?? null
        }
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
