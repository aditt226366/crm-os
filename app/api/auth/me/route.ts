import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { errorResponse, json } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    return json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              slug: user.tenant.slug,
              plan: user.tenant.plan,
              status: user.tenant.status
            }
          : null
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
