import { NextRequest } from "next/server";
import { getRefreshCookie, rotateRefreshToken, setAuthCookies } from "@/lib/auth";
import { errorResponse, json } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const tokens = await rotateRefreshToken(getRefreshCookie(request));
    const response = json({ ok: true });
    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
