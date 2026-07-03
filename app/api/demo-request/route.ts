import { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/api";
import { demoRequestSchema, storeDemoRequest } from "@/lib/demo-request-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => null);
    const input = demoRequestSchema.parse(raw);
    const result = await storeDemoRequest(input);
    return json({ ok: true, storedIn: result.storedIn });
  } catch (error) {
    return errorResponse(error);
  }
}
