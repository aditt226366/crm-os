import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

function prismaDebug(error: unknown) {
  const details = error as { code?: unknown; meta?: unknown; message?: unknown };
  return {
    prismaCode:
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : typeof details.code === "string"
          ? details.code
          : undefined,
    prismaMeta: error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined,
    prismaMessage: typeof details.message === "string" ? details.message : String(error)
  };
}

function isPrismaError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: firstIssue?.message ?? "Request validation failed",
          issues: error.issues
        }
      },
      { status: 400 }
    );
  }

  if (isPrismaError(error)) {
    const debug = prismaDebug(error);
    const message =
      error instanceof Prisma.PrismaClientInitializationError
        ? "Database connection failed. Check DATABASE_URL, DIRECT_URL, and Supabase TLS settings."
        : debug.prismaCode
          ? `Database request failed: ${debug.prismaCode}`
          : "Database request failed.";

    console.error("[api.db] failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      prismaCode: debug.prismaCode,
      prismaMeta: debug.prismaMeta,
      prismaMessage: debug.prismaMessage
    });

    return json(
      {
        error: {
          code: "DATABASE_REQUEST_FAILED",
          message,
          ...(process.env.NODE_ENV !== "production" ? { debug } : {})
        }
      },
      { status: 500 }
    );
  }

  console.error(error);
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong"
      }
    },
    { status: 500 }
  );
}
