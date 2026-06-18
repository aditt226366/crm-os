import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "crm-os",
      timestamp: new Date().toISOString()
    },
    { status: 200 }
  );
}
