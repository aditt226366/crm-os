import { NextRequest } from "next/server";
import { clearAuthCookies, getRefreshCookie, revokeRefreshToken } from "@/lib/auth";
import { errorResponse, json } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    await revokeRefreshToken(getRefreshCookie(request));
    const response = json({ ok: true });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
