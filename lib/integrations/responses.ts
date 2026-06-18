import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError, json } from "@/lib/api";
import { IntegrationError } from "@/lib/integrations/types";

type IntegrationResponseOptions = {
  defaultMessage?: string;
};

function prismaMessage(error: Prisma.PrismaClientKnownRequestError) {
  if (error.code === "P2003") {
    return "Company not found.";
  }
  if (error.code === "P2025") {
    return "Requested integration record was not found.";
  }
  return "Database request failed.";
}

export function integrationErrorResponse(error: unknown, options: IntegrationResponseOptions = {}) {
  if (error instanceof IntegrationError) {
    return json(
      {
        ok: false,
        message: error.message,
        code: error.code,
        field: error.field
      },
      { status: error.status }
    );
  }

  if (error instanceof ApiError) {
    return json(
      {
        ok: false,
        message: error.status === 401 ? "Unauthorized" : error.message,
        code: error.code
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    return json(
      {
        ok: false,
        message: firstIssue?.message ?? "Request validation failed",
        code: "VALIDATION_ERROR",
        field: firstIssue?.path?.join(".") || undefined,
        details: error.issues
      },
      { status: 400 }
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const message = prismaMessage(error);
    console.error("[integrations.api] Prisma error", { code: error.code, message });
    return json(
      {
        ok: false,
        message,
        code: "DATABASE_ERROR"
      },
      { status: error.code === "P2003" || error.code === "P2025" ? 404 : 500 }
    );
  }

  console.error("[integrations.api] Unhandled error", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error)
  });

  return json(
    {
      ok: false,
      message: options.defaultMessage ?? "Integration request failed.",
      code: "INTEGRATION_SERVER_ERROR"
    },
    { status: 500 }
  );
}

export function integrationSuccess(data: Record<string, unknown>, init?: ResponseInit) {
  return json({ ok: true, ...data }, init);
}

export function integrationFailure(data: Record<string, unknown>, init?: ResponseInit) {
  return json({ ok: false, ...data }, init ?? { status: 400 });
}
