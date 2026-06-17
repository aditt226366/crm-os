import type { NextRequest } from "next/server";

import { loginWithRequest } from "@/lib/auth-login";

export async function POST(request: NextRequest) {
  return loginWithRequest(request);
}
