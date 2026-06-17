import { NextRequest } from "next/server";
import { requireFeature } from "@/lib/guards";
import { errorResponse, json } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    await requireFeature(request, "LEAD_MANAGEMENT");
    return json({ ok: true, module: "LEAD_MANAGEMENT", message: "Lead management API foundation ready." });
  } catch (error) {
    return errorResponse(error);
  }
}
