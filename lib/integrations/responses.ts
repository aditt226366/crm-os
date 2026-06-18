import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError, json } from "@/lib/api";
import { IntegrationError } from "@/lib/integrations/types";

type IntegrationResponseOptions = {
  defaultMessage?: string;
  route?: string;
  integrationType?: string;
  companyId?: string;
};

function databaseMessage(error: unknown) {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : undefined;
  return code ? `Database request failed: ${code}` : "Database request failed.";
}

function logDatabaseError(error: unknown, options: IntegrationResponseOptions) {
  const details = error as { name?: unknown; code?: unknown; message?: unknown };
  console.error("[integrations.db] failed", {
    integrationType: options.integrationType,
    companyId: options.companyId,
    errorName: typeof details.name === "string" ? details.name : error instanceof Error ? error.name : "UnknownError",
    errorCode:
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : typeof details.code === "string"
          ? details.code
          : undefined,
    errorMessage: typeof details.message === "string" ? details.message : String(error)
  });
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
    logDatabaseError(error, options);
    return json(
      {
        ok: false,
        code: "DATABASE_REQUEST_FAILED",
        message: databaseMessage(error)
      },
      { status: 500 }
    );
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    logDatabaseError(error, options);
    return json(
      {
        ok: false,
        code: "DATABASE_REQUEST_FAILED",
        message: databaseMessage(error)
      },
      { status: 500 }
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
