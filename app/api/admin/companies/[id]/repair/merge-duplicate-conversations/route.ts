import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, json } from "@/lib/api";
import { mergeDuplicateConversationsForTenant } from "@/lib/contact-identity";
import { requirePlatformAdmin } from "@/lib/guards";
import { ensureLeadWorkspaceSchema } from "@/lib/lead-workspace-schema";
import { safeCreateAuditLog } from "@/lib/audit";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await context.params;
    await ensureLeadWorkspaceSchema();

    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ id }, { slug: id }]
      },
      select: { id: true, name: true, slug: true }
    });
    if (!tenant) {
      throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found.");
    }

    const result = await mergeDuplicateConversationsForTenant(tenant.id);

    void safeCreateAuditLog({
      request,
      actorUserId: admin.id,
      tenantId: tenant.id,
      action: "admin.company_repair_merged_duplicate_conversations",
      entityType: "Tenant",
      entityId: tenant.id,
      newValue: result
    });

    return json({
      ok: true,
      company: tenant,
      result,
      message: `Repair complete: ${result.mergedContacts} duplicate contacts and ${result.mergedConversations} duplicate conversations merged.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
